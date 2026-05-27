import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { prisma } from '../src/lib/prisma';
import 'dotenv/config';

async function run() {
  console.log("=== Setting Up Client for Email ===");
  // Ensure the user and client exist in the database
  const email = "luislazober@gmail.com";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Luis Lazo",
        role: "CLIENT_USER",
        passwordHash: "dummy_hash"
      }
    });
  }
  let client = await prisma.client.findFirst({ where: { userId: user.id } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        userId: user.id,
        taxType: "INDIVIDUAL",
        status: "ONBOARDING"
      }
    });
  }

  console.log("=== Creating W-2 PDF Attachment ===");
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
    fromEmail: email,
    fromName: "Luis Lazo",
    subject: "My Tax Document W2",
    bodyText: "Hi, please process my attached W2 form.",
    attachments: [
      {
        filename: "Google_W2_Email_2025.pdf",
        fileType: "application/pdf",
        base64Data: base64Data,
        fileSize: pdfBytes.length
      }
    ]
  };

  console.log("\nSending simulated email webhook request...");
  const res = await fetch('http://localhost:3000/accounting/api/crm/incoming-email', {
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
    throw new Error(`Email webhook request failed: ${JSON.stringify(data)}`);
  }

  const initialDocs = data.newDocuments || [];
  if (initialDocs.length === 0) {
    throw new Error("No documents created in response");
  }

  const initialPdfDoc = initialDocs[0];
  console.log(`Created Initial PDF Document: ID ${initialPdfDoc.id}, Status ${initialPdfDoc.status}`);

  console.log("\nWaiting 15 seconds for the async background worker to process PDF-to-PNG, OCR, and PDF deletion...");
  await new Promise(resolve => setTimeout(resolve, 15000));

  // Query database to see if the PDF still exists
  console.log("\nQuerying database for original PDF document...");
  const dbPdfDoc = await prisma.document.findUnique({
    where: { id: initialPdfDoc.id }
  });
  console.log("PDF Document search result (expect: STILL EXISTS):", dbPdfDoc ? `STILL EXISTS (Status: ${dbPdfDoc.status}, Category: ${dbPdfDoc.category})` : "DELETED");
  if (!dbPdfDoc) {
    throw new Error("PDF document was deleted!");
  }

  // Query database for companion PNG
  console.log("\nQuerying database for companion PNG document...");
  const dbPngDocs = await prisma.document.findMany({
    where: {
      clientId: client.id,
      name: "Google_W2_Email_2025 (Image Verification).png"
    },
    include: { taxFormData: true }
  });
  console.log(`Found ${dbPngDocs.length} companion PNG documents.`);
  if (dbPngDocs.length > 0) {
    console.log("PNG Document Details:", JSON.stringify(dbPngDocs[0], null, 2));
  }

  // Clean up
  console.log("\nCleaning up database...");
  await prisma.document.deleteMany({
    where: {
      name: {
        in: ["Google_W2_Email_2025.pdf", "Google_W2_Email_2025 (Image Verification).png"]
      }
    }
  });
  console.log("Cleanup complete.");
}

run().catch(console.error);
