import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  const doc = await prisma.document.findFirst({
    where: {
      name: { contains: 'MortgageInterest', mode: 'insensitive' },
      fileType: 'PDF'
    }
  });

  if (!doc || !doc.fileData) {
    console.error('No document found!');
    return;
  }

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(Buffer.from(doc.fileData, 'base64')),
    useSystemFonts: true,
  });

  const pdfDocument = await loadingTask.promise;
  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    console.log(`=== PAGE ${pageNum} ===`);
    console.log(pageText);
    console.log(`=======================\n`);
  }

  await prisma.$disconnect();
}

main();
