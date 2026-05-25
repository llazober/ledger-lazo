import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { extractAndSaveTaxFormData } from '../src/lib/ai-processor';

async function test() {
  console.log("=== Testing Unified Tax Form Ingestion Pipeline ===");

  // 1. Create a dummy client if none exists
  let client = await prisma.client.findFirst({
    include: { user: true }
  });

  if (!client) {
    console.log("Creating dummy user & client...");
    const user = await prisma.user.create({
      data: {
        email: 'test-tax-form@example.com',
        name: 'Test Tax Form Client',
        role: 'CLIENT_USER',
        passwordHash: 'dummy_hash'
      }
    });
    client = await prisma.client.create({
      data: {
        userId: user.id,
        taxType: 'INDIVIDUAL'
      },
      include: { user: true }
    });
  }

  // 2. Create a dummy document for W-2
  console.log("\n--- Testing W-2 Form Extraction ---");
  const docW2 = await prisma.document.create({
    data: {
      name: 'Test_W2_Sheet.png',
      url: 'https://example.com/test-w2.png',
      fileType: 'png',
      fileSize: 1024,
      taxYear: 2026,
      category: 'W2',
      status: 'VALIDATED',
      clientId: client.id,
      extractedText: `
Form W-2 Wage and Tax Statement 2026
a Employee's social security number: 999-00-1111 b Employer identification number (EIN): 12-3456789
c Employer's name: Acme Corp d Control number: 12345
1 Wages, tips, other compensation 2 Federal income tax withheld
$85,000.50 $12,300.20
3 Social security wages 4 Social security tax withheld
$85,000.50 $5,270.00
5 Medicare wages and tips 6 Medicare tax withheld
$85,000.50 $1,232.50
`
    }
  });

  console.log("Created dummy W-2 Document ID:", docW2.id);
  const resultW2 = await extractAndSaveTaxFormData(docW2.id, 'W2', docW2.extractedText || '');
  console.log("W-2 Extraction Result:", JSON.stringify(resultW2, null, 2));

  // 3. Create a dummy document for 1099-NEC
  console.log("\n--- Testing 1099-NEC Form Extraction ---");
  const docNEC = await prisma.document.create({
    data: {
      name: 'Test_1099_NEC.png',
      url: 'https://example.com/test-1099-nec.png',
      fileType: 'png',
      fileSize: 1024,
      taxYear: 2026,
      category: '1099-NEC',
      status: 'VALIDATED',
      clientId: client.id,
      extractedText: `
Form 1099-NEC Nonemployee Compensation 2026
PAYER's TIN: 98-7654321
RECIPIENT's TIN: 999-00-1111
1 Nonemployee compensation: $15,250.00
4 Federal income tax withheld: $1,525.00
`
    }
  });

  console.log("Created dummy 1099-NEC Document ID:", docNEC.id);
  const resultNEC = await extractAndSaveTaxFormData(docNEC.id, '1099-NEC', docNEC.extractedText || '');
  console.log("1099-NEC Extraction Result:", JSON.stringify(resultNEC, null, 2));

  // 4. Retrieve documents with their taxFormData
  console.log("\n--- Verifying Database Fetch & Cascade Deletion ---");
  const fetchedDocs = await prisma.document.findMany({
    where: { id: { in: [docW2.id, docNEC.id] } },
    include: { taxFormData: true }
  });
  console.log("Fetched Documents with taxFormData:", JSON.stringify(fetchedDocs, null, 2));

  // Delete documents and make sure taxFormData records are cascade deleted
  await prisma.document.delete({ where: { id: docW2.id } });
  await prisma.document.delete({ where: { id: docNEC.id } });

  const remainingW2 = await prisma.taxFormData.findUnique({ where: { documentId: docW2.id } });
  const remainingNEC = await prisma.taxFormData.findUnique({ where: { documentId: docNEC.id } });

  console.log("Remaining TaxFormData for W2 (expect null):", remainingW2);
  console.log("Remaining TaxFormData for 1099-NEC (expect null):", remainingNEC);
  console.log("\n=== Test Completed Successfully ===");
}

test()
  .catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
