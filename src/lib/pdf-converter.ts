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
function scorePageForCategory(pageText: string, category: string): number {
  const cat = category.toLowerCase();
  let score = 0;

  // Helper helper to check matches
  const has = (terms: string[]) => terms.some(term => pageText.includes(term));
  const count = (terms: string[]) => terms.filter(term => pageText.includes(term)).length;

  if (cat === 'w2' || cat === 'w-2') {
    if (has(['form w-2', 'form w2', 'form w - 2'])) score += 12;
    score += count(['wages, tips, other compensation', 'wages, tips', 'social security wages', 'medicare wages and tips', 'medicare wages', 'social security tax withheld', 'federal income tax withheld']) * 5;
    score += count(['copy b', 'copy c', 'copy 1', 'copy d', 'copy b ', 'copy c ', 'copy d ']) * 3;
    score += count(['department of the treasury', 'internal revenue service']) * 2;
  }
  else if (cat === '1099-nec') {
    if (has(['form 1099-nec', 'form 1099nec', 'form 1099 nec'])) score += 12;
    score += count(['nonemployee compensation', 'federal income tax withheld']) * 8;
    score += count(["payer's federal identification number", "payer's tin", "recipient's identification number", "recipient's tin"]) * 4;
    score += count(['copy b', 'copy c', 'copy a', 'copy 1']) * 3;
  }
  else if (cat === '1099-misc') {
    if (has(['form 1099-misc', 'form 1099misc', 'form 1099 misc'])) score += 12;
    score += count(['rents', 'royalties', 'other income', 'federal income tax withheld', 'substitute payments']) * 5;
    score += count(["payer's federal identification number", "payer's tin", "recipient's identification number", "recipient's tin"]) * 4;
    score += count(['copy b', 'copy c', 'copy a', 'copy 1']) * 3;
  }
  else if (cat === '1099-int') {
    if (has(['form 1099-int', 'form 1099int', 'form 1099 int'])) score += 12;
    score += count(['interest income', 'early withdrawal penalty', 'federal income tax withheld']) * 6;
    score += count(['copy b', 'copy c', 'copy a', 'copy 1']) * 3;
  }
  else if (cat === '1099-div') {
    if (has(['form 1099-div', 'form 1099div', 'form 1099 div'])) score += 12;
    score += count(['total ordinary dividends', 'qualified dividends', 'total capital gain dist', 'capital gain', 'federal income tax withheld']) * 6;
    score += count(['copy b', 'copy c', 'copy a', 'copy 1']) * 3;
  }
  else if (cat === '1099-r') {
    if (has(['form 1099-r', 'form 1099r', 'form 1099 r'])) score += 12;
    score += count(['gross distribution', 'taxable amount', 'distribution code', 'distribution code(s)', 'federal income tax withheld']) * 6;
    score += count(['copy b', 'copy c', 'copy a', 'copy 1']) * 3;
  }
  else if (cat === '1095-a' || cat === '1095a') {
    if (has(['form 1095-a', 'form 1095a', 'form 1095 a'])) score += 12;
    score += count(['health insurance marketplace statement', 'marketplace identifier', 'policy number', 'monthly enrollment premiums', 'annual enrollment premiums', 'monthly advance payment of premium tax credit', 'annual advance ptc']) * 6;
  }
  else if (cat === '1099-ssa' || cat === 'ssa-1099' || cat === 'ssa1099') {
    if (has(['ssa-1099', 'form ssa-1099', 'ssa1099'])) score += 12;
    score += count(['social security benefit statement', 'benefits paid', 'net benefits', 'net social security benefits', 'federal income tax withheld']) * 6;
  }
  else if (cat === '1098') {
    if (has(['form 1098', 'form 1098', 'form 1098'])) score += 12;
    score += count(['mortgage interest statement', 'mortgage interest received', 'outstanding mortgage principal', 'outstanding principal', 'mortgage origination date', 'origination date', 'refund of overpaid interest', 'interest refund', 'mortgage insurance premiums', 'points paid', 'real estate taxes']) * 6;
  }

  return score;
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
  let highestScore = 0;

  if (category) {
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ').toLowerCase();

        const score = scorePageForCategory(pageText, category);
        console.log(`[PDF Converter] Page ${pageNum} scored ${score} for category "${category}"`);

        if (score > highestScore) {
          highestScore = score;
          pageToRender = pageNum;
        }
      } catch (err) {
        console.error(`[PDF Converter] Failed to scan text for page ${pageNum}:`, err);
      }
    }
    
    if (highestScore > 0) {
      console.log(`[PDF Converter] Selected Page ${pageToRender} (score: ${highestScore}) for category "${category}"`);
    } else {
      console.log(`[PDF Converter] No form pages matched for category "${category}". Defaulting to page 1.`);
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
