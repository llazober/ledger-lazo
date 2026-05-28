import { createCanvas, Path2D, DOMMatrix, DOMPoint, DOMRect } from '@napi-rs/canvas';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

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
  
  // Strip all whitespace and punctuation/dashes to be 100% layout and format-independent
  const clean = pageText.replace(/[\s\-\_\,\.\/\(\)\*]/g, '').toLowerCase();
  
  let score = 0;

  // Helper check
  const has = (term: string) => clean.includes(term);
  const count = (terms: string[]) => terms.filter(term => clean.includes(term)).length;

  if (cat === 'w2' || cat === 'w-2') {
    if (has('formw2')) score += 15;
    if (has('ombno15450008')) score += 20; // Official W-2 OMB No.
    score += count(['wagestipsothercompensation', 'wagestips', 'socialsecuritywages', 'medicarewagesandtips', 'medicarewages', 'socialsecuritytaxwithheld', 'federalincometaxwithheld']) * 8;
    score += count(['copyb', 'copyc', 'copy1', 'copyd']) * 4;
    score += count(['departmentofthetreasury', 'internalrevenueservice']) * 3;
  }
  else if (cat === '1099-nec') {
    if (has('form1099nec')) score += 15;
    if (has('ombno15450115')) score += 20; // NEC/MISC OMB No.
    score += count(['nonemployeecompensation', 'federalincometaxwithheld']) * 10;
    score += count(['payerfederalidentificationnumber', 'payerstin', 'recipientidentificationnumber', 'recipientstin']) * 5;
    score += count(['copyb', 'copyc', 'copya', 'copy1']) * 4;
  }
  else if (cat === '1099-misc') {
    if (has('form1099misc')) score += 15;
    if (has('ombno15450115')) score += 20; // NEC/MISC OMB No.
    score += count(['rents', 'royalties', 'otherincome', 'federalincometaxwithheld', 'substitutepayments']) * 8;
    score += count(['payerfederalidentificationnumber', 'payerstin', 'recipientidentificationnumber', 'recipientstin']) * 5;
    score += count(['copyb', 'copyc', 'copya', 'copy1']) * 4;
  }
  else if (cat === '1099-int') {
    if (has('form1099int')) score += 15;
    if (has('ombno15450112')) score += 20; // INT OMB No.
    score += count(['interestincome', 'earlywithdrawalpenalty', 'federalincometaxwithheld']) * 10;
    score += count(['copyb', 'copyc', 'copya', 'copy1']) * 4;
  }
  else if (cat === '1099-div') {
    if (has('form1099div')) score += 15;
    if (has('ombno15450110')) score += 20; // DIV OMB No.
    score += count(['totalordinarydividends', 'qualifieddividends', 'totalcapitalgaindist', 'capitalgain', 'federalincometaxwithheld']) * 10;
    score += count(['copyb', 'copyc', 'copya', 'copy1']) * 4;
  }
  else if (cat === '1099-r') {
    if (has('form1099r')) score += 15;
    if (has('ombno15450119')) score += 20; // R OMB No.
    score += count(['grossdistribution', 'taxableamount', 'distributioncode', 'federalincometaxwithheld']) * 10;
    score += count(['copyb', 'copyc', 'copya', 'copy1']) * 4;
  }
  else if (cat === '1095-a' || cat === '1095a') {
    if (has('form1095a')) score += 15;
    if (has('ombno15452232')) score += 20; // 1095-A OMB No.
    score += count(['healthinsurancemarketplacestatement', 'marketplaceidentifier', 'policynumber', 'monthlyenrollmentpremiums', 'annualenrollmentpremiums', 'monthlyadvancepaymentofpremiumtaxcredit', 'annualadvanceptc']) * 10;
  }
  else if (cat === '1099-ssa' || cat === 'ssa-1099' || cat === 'ssa1099') {
    if (has('formssa1099') || has('ssa1099')) score += 15;
    if (has('ombno09600616')) score += 20; // SSA OMB No.
    score += count(['socialsecuritybenefitstatement', 'benefitspaid', 'netbenefits', 'netsocialsecuritybenefits', 'federalincometaxwithheld']) * 10;
  }
  else if (cat === '1098') {
    if (has('form1098')) score += 15;
    if (has('ombno15451380')) score += 20; // 1098 OMB No.
    score += count(['mortgageintereststatement', 'mortgageinterestreceived', 'outstandingmortgageprincipal', 'outstandingprincipal', 'mortgageoriginationdate', 'originationdate', 'refundofoverpaidinterest', 'interestrefund', 'mortgageinsurancepremiums', 'pointspaid', 'realestatetaxes']) * 8;
    score += count(['copyb', 'copyc', 'copya', 'copy1']) * 4;
    score += count(['departmentofthetreasury', 'internalrevenueservice']) * 3;
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
  
  // Configure PDF.js worker explicitly for Node/Next environment
  // Check if we are running in standalone production (no node_modules at process.cwd())
  let workerPath = path.join(process.cwd(), 'public/pdf.worker.mjs');
  if (!fs.existsSync(workerPath)) {
    workerPath = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();

  let standardFontDataUrl = path.join(process.cwd(), 'public/standard_fonts') + '/';
  if (!fs.existsSync(standardFontDataUrl)) {
    standardFontDataUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts') + '/';
  }
  
  let cMapUrl = path.join(process.cwd(), 'public/cmaps') + '/';
  if (!fs.existsSync(cMapUrl)) {
    cMapUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps') + '/';
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    useSystemFonts: false,
  });

  const pdfDocument = await loadingTask.promise;
  const imagesBase64: string[] = [];
  try {
    let pageToRender = 1;
    let highestScore = 0;

    // 1. Scan all pages for OMB numbers first to find a guaranteed match
    let detectedPage = -1;
    let detectedCategory = "";
    
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ').toLowerCase();
        const clean = pageText.replace(/[\s\-\_\,\.\/\(\)\*]/g, '').toLowerCase();

        // Check unique OMB control number fingerprints
        if (clean.includes('15451380')) {
          detectedPage = pageNum;
          detectedCategory = '1098';
          break;
        }
        if (clean.includes('15450008')) {
          detectedPage = pageNum;
          detectedCategory = 'W2';
          break;
        }
        if (clean.includes('15450112')) {
          detectedPage = pageNum;
          detectedCategory = '1099-INT';
          break;
        }
        if (clean.includes('15450110')) {
          detectedPage = pageNum;
          detectedCategory = '1099-DIV';
          break;
        }
        if (clean.includes('15450119')) {
          detectedPage = pageNum;
          detectedCategory = '1099-R';
          break;
        }
        if (clean.includes('15452232')) {
          detectedPage = pageNum;
          detectedCategory = '1095-A';
          break;
        }
        if (clean.includes('09600616')) {
          detectedPage = pageNum;
          detectedCategory = '1099-SSA';
          break;
        }
        if (clean.includes('15450115')) {
          detectedPage = pageNum;
          detectedCategory = clean.includes('nonemployee') ? '1099-NEC' : '1099-MISC';
          break;
        }
      } catch (e) {
        // Ignored
      }
    }

    if (detectedPage !== -1) {
      console.log(`[PDF Converter] 100% matched Form OMB fingerprint on page ${detectedPage} -> category "${detectedCategory}"`);
      pageToRender = detectedPage;
    } else if (category) {
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
      
      // Calculate dynamic scale factor to prevent out-of-memory errors on large scanned PDFs
      const defaultViewport = page.getViewport({ scale: 1.0 });
      const maxDimension = Math.max(defaultViewport.width, defaultViewport.height);
      const targetMaxDim = 1500; // Optimal resolution for Vision API and manual review
      let scale = targetMaxDim / maxDimension;
      if (scale > 2.0) scale = 2.0; // Cap at 2.0 to avoid unnecessary upscaling
      if (scale < 0.8) scale = 0.8; // Set lower bound to preserve OCR readability

      console.log(`[PDF Converter] Page native dimensions: ${defaultViewport.width.toFixed(1)}x${defaultViewport.height.toFixed(1)}. Selected rendering scale: ${scale.toFixed(2)} (${(defaultViewport.width * scale).toFixed(0)}x${(defaultViewport.height * scale).toFixed(0)})`);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context as any,
        viewport: viewport,
        canvas: canvas as any,
        renderInteractiveForms: true,
      } as any).promise;

      const pngBuffer = canvas.toBuffer('image/png');
      imagesBase64.push(pngBuffer.toString('base64'));
    } catch (pageErr) {
      console.error(`[PDF Converter] Failed to render page ${pageToRender}:`, pageErr);
    }
  } finally {
    try {
      await pdfDocument.destroy();
      console.log(`[PDF Converter] Successfully destroyed pdfDocument instance to release native memory.`);
    } catch (destroyErr) {
      console.error("[PDF Converter] Error destroying pdfDocument:", destroyErr);
    }
  }

  return imagesBase64;
}
