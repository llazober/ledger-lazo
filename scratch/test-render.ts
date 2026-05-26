import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import fs from 'fs';
import path from 'path';
import { createCanvas, DOMMatrix, Path2D, DOMPoint, DOMRect } from '@napi-rs/canvas';

(global as any).DOMMatrix = DOMMatrix;
(global as any).Path2D = Path2D;
(global as any).DOMPoint = DOMPoint;
(global as any).DOMRect = DOMRect;

async function main() {
  const doc = await prisma.document.findFirst({
    where: {
      OR: [
        { name: { contains: '1098', mode: 'insensitive' } },
        { name: { contains: 'Mortgage', mode: 'insensitive' } },
        { category: '1098' }
      ],
      fileType: 'PDF',
      fileData: { not: null }
    }
  });

  if (!doc || !doc.fileData) {
    console.error('No matching 1098 or Mortgage PDF document found with fileData!');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found document: ${doc.name} (${doc.id})`);
  const pdfBuffer = Buffer.from(doc.fileData, 'base64');

  const standardFontDataUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts') + '/';
  const cMapUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps') + '/';

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const tests = [
    { name: 'sysfonts_true_forms_true', useSystemFonts: true, renderInteractiveForms: true },
    { name: 'sysfonts_false_forms_true', useSystemFonts: false, renderInteractiveForms: true },
    { name: 'sysfonts_false_forms_false', useSystemFonts: false, renderInteractiveForms: false },
    { name: 'sysfonts_true_forms_false', useSystemFonts: true, renderInteractiveForms: false }
  ];

  for (const t of tests) {
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        standardFontDataUrl,
        cMapUrl,
        cMapPacked: true,
        useSystemFonts: t.useSystemFonts,
      });

      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(3); // Page 3 is the 1098 Form page
      
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context as any,
        viewport: viewport,
        canvas: canvas as any,
        renderInteractiveForms: t.renderInteractiveForms,
      }).promise;

      const pngBuffer = canvas.toBuffer('image/png');
      const outPath = path.join(__dirname, `test_${t.name}.png`);
      fs.writeFileSync(outPath, pngBuffer);
      console.log(`Test [${t.name}]: Saved to ${outPath} (size: ${pngBuffer.length} bytes)`);
    } catch (err: any) {
      console.error(`Failed test [${t.name}]:`, err.message);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
