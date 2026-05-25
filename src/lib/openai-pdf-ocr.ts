import OpenAI, { toFile } from 'openai';
import { createCanvas } from '@napi-rs/canvas';

if (typeof (global as any).DOMMatrix === 'undefined') {
  (global as any).DOMMatrix = class {};
}
// Require legacy build for node.js compatibility
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Performs high-fidelity Vision OCR on a PDF document by rendering pages as PNGs (using canvas/pdfjs)
 * and running Chat Completions with detail: high. If rendering fails, it falls back to uploading
 * the PDF to the OpenAI Files API.
 * 
 * @param fileBuffer The raw buffer of the PDF file.
 * @param filename The name of the file.
 * @returns The transcribed text content from the PDF.
 */
export async function performVisionOcrWithFilesApi(fileBuffer: Buffer, filename: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured in the environment.');
  }

  // 1. First attempt: Render PDF pages to PNG and send via detail: high vision completions
  try {
    console.log(`[OpenAI OCR] Attempting to render PDF "${filename}" pages to PNG...`);
    const data = new Uint8Array(fileBuffer);
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;
    console.log(`[OpenAI OCR] PDF loaded. Total pages: ${pdf.numPages}`);
    
    // Scanned tax returns/statements are typically 1-3 pages. We cap at 4 pages to avoid token limits.
    const maxPages = Math.min(pdf.numPages, 4);
    const imageMessages: any[] = [];
    
    for (let i = 1; i <= maxPages; i++) {
      console.log(`[OpenAI OCR] Rendering page ${i}...`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for high-fidelity OCR reading
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      const pngBuffer = canvas.toBuffer('image/png');
      const base64 = pngBuffer.toString('base64');
      imageMessages.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: 'high'
        }
      });
    }
    
    if (imageMessages.length > 0) {
      console.log(`[OpenAI OCR] Successfully rendered ${imageMessages.length} pages. Calling GPT-4o Vision with high detail...`);
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are an expert tax document OCR system.
Carefully transcribe ALL visible text from this scanned tax document.

CRITICAL RULES:
1. Capture the FORM TYPE exactly (e.g. "Form 1099-NEC", "Form W-2", "Form 1099-MISC", "Form 1095-A", "Form 1099-R")
2. Capture every box NUMBER and its LABEL and its DOLLAR VALUE on the same line
   Example: "Box 1 Nonemployee compensation: 1600.00"
3. Capture Payer name, Payer TIN/EIN, Recipient name, Recipient TIN/SSN.
   NOTE: On all Form 1099 variants, "PAYER'S TIN" is in the left box and "RECIPIENT'S TIN" is in the right box. Ensure the LEFT value is mapped to Payer's TIN/EIN, and the RIGHT value is mapped to Recipient's TIN/SSN. Do not swap them.
4. Do NOT summarize. Transcribe the actual text exactly as printed.
5. If multiple copies of the same form appear (Copy B, Copy C), transcribe only ONE copy.
6. For Form 1095-A Part III (Coverage Information), you MUST fully transcribe the table row-by-row and column-by-column, listing all months (January-December) and Row 33 (Annual Totals).
   Format each month and the totals row exactly like this to ensure no columns are skipped:
   - [Month]: Column A = [value], Column B = [value], Column C = [value]
   - 33 Annual Totals: Column A = [value], Column B = [value], Column C = [value]
   (e.g., "33 Annual Totals: Column A = 12230.40, Column B = 12610.80, Column C = 11472.00")
   Do NOT skip any column or monthly values.`
              },
              ...imageMessages
            ]
          }
        ],
        max_tokens: 4000
      });
      
      const resultText = response.choices[0].message?.content || '';
      console.log(`[OpenAI OCR] GPT-4o image vision transcription completed. Length: ${resultText.length}`);
      if (resultText.trim().length > 10) {
        return '[OCR_METHOD: CANVAS]\n' + resultText;
      }
    }
  } catch (err: any) {
    console.warn(`[OpenAI OCR] Rendering pages to PNG failed, falling back to Files API upload. Error:`, err.message);
  }

  // 2. Second attempt: Fallback to uploading PDF to Files API
  let fileId: string | null = null;
  try {
    console.log(`[OpenAI OCR] Uploading PDF file "${filename}" to OpenAI Files API...`);
    const file = await openai.files.create({
      file: await toFile(fileBuffer, filename, { type: 'application/pdf' }),
      purpose: 'user_data'
    });
    fileId = file.id;
    console.log(`[OpenAI OCR] File uploaded successfully. ID: ${fileId}. Calling GPT-4o...`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an expert tax document OCR system.
Carefully transcribe ALL visible text from this scanned tax document.

CRITICAL RULES:
1. Capture the FORM TYPE exactly (e.g. "Form 1099-NEC", "Form W-2", "Form 1099-MISC", "Form 1095-A", "Form 1099-R")
2. Capture every box NUMBER and its LABEL and its DOLLAR VALUE on the same line
   Example: "Box 1 Nonemployee compensation: 1600.00"
3. Capture Payer name, Payer TIN/EIN, Recipient name, Recipient TIN/SSN.
   NOTE: On all Form 1099 variants, "PAYER'S TIN" is in the left box and "RECIPIENT'S TIN" is in the right box. Ensure the LEFT value is mapped to Payer's TIN/EIN, and the RIGHT value is mapped to Recipient's TIN/SSN. Do not swap them.
4. Do NOT summarize. Transcribe the actual text exactly as printed.
5. If multiple copies of the same form appear (Copy B, Copy C), transcribe only ONE copy.
6. For Form 1095-A Part III (Coverage Information), you MUST fully transcribe the table row-by-row and column-by-column, listing all months (January-December) and Row 33 (Annual Totals).
   Format each month and the totals row exactly like this to ensure no columns are skipped:
   - [Month]: Column A = [value], Column B = [value], Column C = [value]
   - 33 Annual Totals: Column A = [value], Column B = [value], Column C = [value]
   (e.g., "33 Annual Totals: Column A = 12230.40, Column B = 12610.80, Column C = 11472.00")
   Do NOT skip any column or monthly values.`
            },
            {
              type: 'file',
              file: {
                file_id: fileId
              }
            } as any
          ]
        }
      ]
    });

    const resultText = response.choices[0].message?.content || '';
    console.log(`[OpenAI OCR] GPT-4o transcription completed. Length: ${resultText.length}`);
    return '[OCR_METHOD: FILES_API]\n' + resultText;
  } catch (err: any) {
    console.error('[OpenAI OCR] Error performing PDF vision OCR:', err.message);
    throw err;
  } finally {
    if (fileId) {
      try {
        console.log(`[OpenAI OCR] Cleaning up uploaded file ${fileId}...`);
        await openai.files.delete(fileId);
        console.log('[OpenAI OCR] Cleanup successful.');
      } catch (delErr: any) {
        console.error(`[OpenAI OCR] Failed to delete file ${fileId} during cleanup:`, delErr.message);
      }
    }
  }
}
