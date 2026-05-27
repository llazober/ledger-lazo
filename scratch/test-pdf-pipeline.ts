import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { prisma } from '../src/lib/prisma';
import 'dotenv/config';

async function run() {
  console.log("=== Creating Simulated W-2 PDF ===");
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  page.drawText("Form W-2 Wage and Tax Statement 2025", { x: 50, y: 350, size: 20, font, color: rgb(0, 0, 0) });
  page.drawText("a Employee SSN: 000-11-2222", { x: 50, y: 300, size: 12, font });
  page.drawText("b Employer EIN: 12-3456789", { x: 50, y: 280, size: 12, font });
  page.drawText("1 Wages, tips, other comp: $94,500.00", { x: 50, y: 250, size: 12, font });
  page.drawText("2 Federal income tax withheld: $14,200.00", { x: 50, y: 230, size: 12, font });
  page.drawText("Employer Name: Google Inc", { x: 50, y: 200, size: 12, font });
  page.drawText("Employee Name: Luis Lazo", { x: 50, y: 180, size: 12, font });
  page.drawText("OMB No. 1545-0008", { x: 50, y: 150, size: 12, font }); // Fingerprint

  const pdfBytes = await pdfDoc.save();
  const base64Data = Buffer.from(pdfBytes).toString('base64');
  console.log("Simulated PDF generated successfully.");

  const payload = {
    name: "Google_W2_2025.pdf",
    fileSize: pdfBytes.length,
    fileType: "pdf",
    fileData: base64Data
  };

  console.log("\nSending simulated PDF upload request to CRM Document Route...");
  const res = await fetch('http://localhost:3000/accounting/api/crm/document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  console.log("Response Status:", res.status);
  const data = await res.json();
  console.log("Response JSON:", JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Upload request failed: ${JSON.stringify(data)}`);
  }

  const returnedDoc = data.document;
  console.log("\nReturned Document ID:", returnedDoc.id);
  console.log("Returned Document Name:", returnedDoc.name);
  console.log("Returned Document FileType:", returnedDoc.fileType);
  console.log("Returned Document Category:", returnedDoc.category);

  // Query database to see if the PDF is preserved
  console.log("\nSearching database for documents matching the original PDF name...");
  const dbPdfDocs = await prisma.document.findMany({
    where: { name: "Google_W2_2025.pdf" }
  });
  console.log(`Found ${dbPdfDocs.length} PDF records matching the original name (expect: 1).`);
  if (dbPdfDocs.length === 0) {
    throw new Error("PDF document was not saved in database!");
  }

  console.log("\nSearching database for the created PNG document...");
  const dbPngDocs = await prisma.document.findMany({
    where: { name: "Google_W2_2025 (Image Verification).png" },
    include: { taxFormData: true }
  });
  console.log(`Found ${dbPngDocs.length} PNG records in the database (expect: 1).`);
  if (dbPngDocs.length === 0) {
    throw new Error("PNG document was not saved in database!");
  }
  console.log("PNG Document details:", JSON.stringify(dbPngDocs[0], null, 2));

  // Cleanup test documents from database
  console.log("\nCleaning up test documents from database...");
  await prisma.document.deleteMany({
    where: {
      name: {
        in: ["Google_W2_2025.pdf", "Google_W2_2025 (Image Verification).png"]
      }
    }
  });
  console.log("Cleanup finished.");
}

run().catch(console.error);
