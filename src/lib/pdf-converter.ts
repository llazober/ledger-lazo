import { createCanvas, Path2D, DOMMatrix, DOMPoint, DOMRect } from '@napi-rs/canvas';
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
function getCategoryKeywords(category: string): string[] {
  const cat = category.toLowerCase();
  if (cat === 'w2' || cat === 'w-2') {
    return ['w-2', 'w2', 'wage and tax statement', 'wages, tips', 'social security wages'];
  }
  if (cat === '1099-nec') {
    return ['1099-nec', '1099nec', 'nonemployee compensation'];
  }
  if (cat === '1099-misc') {
    return ['1099-misc', '1099misc', 'rents', 'royalties', 'other income'];
  }
  if (cat === '1099-int') {
    return ['1099-int', '1099int', 'interest income'];
  }
  if (cat === '1099-div') {
    return ['1099-div', '1099div', 'dividends and distributions'];
  }
  if (cat === '1099-r') {
    return ['1099-r', '1099r', 'distributions from pensions', 'retirement', 'gross distribution'];
  }
  if (cat === '1095-a' || cat === '1095a') {
    return ['1095-a', '1095a', 'health insurance marketplace statement'];
  }
  if (cat === '1099-ssa' || cat === 'ssa-1099' || cat === 'ssa1099') {
    return ['ssa-1099', 'ssa1099', 'social security benefit statement'];
  }
  if (cat === '1098') {
    return ['1098', 'mortgage interest statement'];
  }
  return [];
}

/**
 * Converts a PDF buffer into an array of base64-encoded PNG image strings.
 * Mocking DOMMatrix globally is required because Node.js does not have it built-in,
 * and PDF.js depends on it for rendering page viewports.
 * 
 * If a category is supplied, it scans the PDF text layers to identify the single
 * page that contains the actual tax form, rendering only that page to exclude covers/instructions.
 * 
 * @param pdfBuffer The raw buffer of the PDF file.
 * @param maxPages The maximum number of pages to convert.
 * @param category The classified category of the tax document (e.g. W2, 1099-R, etc.)
 * @returns Array of base64-encoded PNG images.
 */
export async function convertPdfToImages(pdfBuffer: Buffer, maxPages: number = 3, category?: string): Promise<string[]> {
  // Unconditionally set global native Path2D, DOMMatrix, DOMPoint, and DOMRect classes from @napi-rs/canvas.
  (global as any).DOMMatrix = DOMMatrix;
  (global as any).Path2D = Path2D;
  (global as any).DOMPoint = DOMPoint;
  (global as any).DOMRect = DOMRect;

  // Dynamically import pdfjs-dist legacy ESM build for compatibility in Node environments
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  });

  const pdfDocument = await loadingTask.promise;
  const imagesBase64: string[] = [];

  let pageToRender = 1;
  let found = false;

  if (category) {
    const keywords = getCategoryKeywords(category);
    if (keywords.length > 0) {
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ').toLowerCase();

          const hasKeyword = keywords.some(kw => pageText.includes(kw));
          if (hasKeyword) {
            pageToRender = pageNum;
            found = true;
            console.log(`[PDF Converter] Identified target form category "${category}" on page ${pageNum}`);
            break;
          }
        } catch (err) {
          console.error(`[PDF Converter] Failed to scan text for page ${pageNum}:`, err);
        }
      }
    }
  }

  // If the target page was not found, we fallback to page 1.
  try {
    console.log(`[PDF Converter] Rendering page ${pageToRender} of ${pdfDocument.numPages} to companion PNG...`);
    const page = await pdfDocument.getPage(pageToRender);
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
    console.error(`[PDF Converter] Failed to render page ${pageToRender}:`, pageErr);
  }

  return imagesBase64;
}
