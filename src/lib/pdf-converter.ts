import { createCanvas, Path2D } from '@napi-rs/canvas';
import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Converts a PDF buffer into an array of base64-encoded PNG image strings.
 * Mocking DOMMatrix globally is required because Node.js does not have it built-in,
 * and PDF.js depends on it for rendering page viewports.
 * 
 * @param pdfBuffer The raw buffer of the PDF file.
 * @param maxPages The maximum number of pages to convert (default is 3 to save token/API costs).
 * @returns Array of base64-encoded PNG images.
 */
export async function convertPdfToImages(pdfBuffer: Buffer, maxPages: number = 3): Promise<string[]> {
  // Mock DOMMatrix globally if not present
  if (typeof (global as any).DOMMatrix === 'undefined') {
    (global as any).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor() {}
    };
  }

  // Set global Path2D so PDF.js CanvasGraphics uses native Path2D
  if (typeof (global as any).Path2D === 'undefined') {
    (global as any).Path2D = Path2D;
  }

  // Dynamically import pdfjs-dist legacy ESM build for compatibility in Node environments
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Fix: Explicitly resolve pdf.worker.mjs path from the public folder to ensure it is deployed in standalone container builds
  const workerPath = path.join(process.cwd(), 'public/pdf.worker.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  });

  const pdfDocument = await loadingTask.promise;
  const imagesBase64: string[] = [];

  const pagesToConvert = Math.min(pdfDocument.numPages, maxPages);

  for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
    try {
      const page = await pdfDocument.getPage(pageNum);
      // scale: 2.0 provides 150-200 DPI visual quality, perfect for Vision OCR
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context as any,
        viewport: viewport,
        canvas: canvas as any,
      }).promise;

      const pngBuffer = canvas.toBuffer('image/png');
      imagesBase64.push(pngBuffer.toString('base64'));
    } catch (pageErr) {
      console.error(`[PDF Converter] Failed to render page ${pageNum}:`, pageErr);
    }
  }

  return imagesBase64;
}
