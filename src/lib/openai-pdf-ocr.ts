import OpenAI, { toFile } from 'openai';
import { convertPdfToImages } from './pdf-converter';

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
    console.log(`[OpenAI OCR] Attempting to render PDF "${filename}" pages to PNG using convertPdfToImages...`);
    const pagesBase64 = await convertPdfToImages(fileBuffer, 4);
    console.log(`[OpenAI OCR] PDF loaded. Total rendered pages: ${pagesBase64.length}`);
    
    const imageMessages: any[] = [];
    for (const base64 of pagesBase64) {
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
      const systemInstruction = `You are an expert tax document OCR system.
Carefully transcribe ALL visible text from this scanned tax document.

CRITICAL RULES:
1. Capture the FORM TYPE exactly (e.g. "Form 1099-NEC", "Form W-2", "Form 1099-MISC", "Form 1095-A", "Form 1099-R")
2. Capture every box NUMBER and its LABEL and its DOLLAR VALUE on the same line.
   Example: "Box 1 Nonemployee compensation: 1600.00"
3. Capture Payer name, Payer TIN/EIN, Recipient name, Recipient TIN/SSN.
   NOTE: On all Form 1099 variants, "PAYER'S TIN" is in the left box and "RECIPIENT'S TIN" is in the right box. Ensure the LEFT value is mapped to Payer's TIN/EIN, and the RIGHT value is mapped to Recipient's TIN/SSN. Do not swap them.
4. Do NOT summarize. Transcribe the actual text exactly as printed.
5. MULTI-COPY / DUPLICATE PREVENTION: Many tax documents (especially Form 1099s and W-2s) print multiple copies of the same form on a single page (e.g. Copy B on the top half and Copy 2 on the bottom half). 
   You MUST transcribe the boxes from ONLY ONE copy. Do NOT sum, multiply, double, or combine the dollar values from the different copies or halves. If Box 1 shows 4235.76 in both the top half and bottom half, the Box 1 value is 4235.76, NOT 8471.52.
6. For Form 1095-A (Health Insurance Marketplace Statement):
   - Box 2 Marketplace-assigned policy number: Extract this value exactly as written (e.g. 188281014).
   - Box 5 Recipient's SSN: Read the digits with extreme precision. Do NOT confuse 90 and 09, or 1490 and 1409. (e.g. "xxx-xx-1490").
   - Box 8 Recipient's spouse's SSN: Read the digits with extreme precision (e.g. "xxx-xx-0174").
   - Part III (Coverage Information): You MUST transcribe all 3 columns (A, B, and C) for every month and Row 33 (Annual Totals).
     * Column A: Monthly enrollment premiums (leftmost column)
     * Column B: Monthly second lowest cost silver plan (SLCSP) premium (middle column)
     * Column C: Monthly advance payment of premium tax credit (rightmost column)
     Format each month and Row 33 exactly like this, using standard dollar values:
     - [Month]: Column A = [value], Column B = [value], Column C = [value]
     - 33 Annual Totals: Column A = [value], Column B = [value], Column C = [value]
     Example: "33 Annual Totals: Column A = 12230.40, Column B = 12610.80, Column C = 11472.00"`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemInstruction
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Here is the scanned tax document. Please transcribe all text following the system instructions.'
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

    const systemInstruction = `You are an expert tax document OCR system.
Carefully transcribe ALL visible text from this scanned tax document.

CRITICAL RULES:
1. Capture the FORM TYPE exactly (e.g. "Form 1099-NEC", "Form W-2", "Form 1099-MISC", "Form 1095-A", "Form 1099-R")
2. Capture every box NUMBER and its LABEL and its DOLLAR VALUE on the same line.
   Example: "Box 1 Nonemployee compensation: 1600.00"
3. Capture Payer name, Payer TIN/EIN, Recipient name, Recipient TIN/SSN.
   NOTE: On all Form 1099 variants, "PAYER'S TIN" is in the left box and "RECIPIENT'S TIN" is in the right box. Ensure the LEFT value is mapped to Payer's TIN/EIN, and the RIGHT value is mapped to Recipient's TIN/SSN. Do not swap them.
4. Do NOT summarize. Transcribe the actual text exactly as printed.
5. MULTI-COPY / DUPLICATE PREVENTION: Many tax documents (especially Form 1099s and W-2s) print multiple copies of the same form on a single page (e.g. Copy B on the top half and Copy 2 on the bottom half). 
   You MUST transcribe the boxes from ONLY ONE copy. Do NOT sum, multiply, double, or combine the dollar values from the different copies or halves. If Box 1 shows 4235.76 in both the top half and bottom half, the Box 1 value is 4235.76, NOT 8471.52.
6. For Form 1095-A (Health Insurance Marketplace Statement):
   - Box 2 Marketplace-assigned policy number: Extract this value exactly as written (e.g. 188281014).
   - Box 5 Recipient's SSN: Read the digits with extreme precision. Do NOT confuse 90 and 09, or 1490 and 1409. (e.g. "xxx-xx-1490").
   - Box 8 Recipient's spouse's SSN: Read the digits with extreme precision (e.g. "xxx-xx-0174").
   - Part III (Coverage Information): You MUST transcribe all 3 columns (A, B, and C) for every month and Row 33 (Annual Totals).
     * Column A: Monthly enrollment premiums (leftmost column)
     * Column B: Monthly second lowest cost silver plan (SLCSP) premium (middle column)
     * Column C: Monthly advance payment of premium tax credit (rightmost column)
     Format each month and Row 33 exactly like this, using standard dollar values:
     - [Month]: Column A = [value], Column B = [value], Column C = [value]
     - 33 Annual Totals: Column A = [value], Column B = [value], Column C = [value]
     Example: "33 Annual Totals: Column A = 12230.40, Column B = 12610.80, Column C = 11472.00"`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemInstruction
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Here is the scanned tax document. Please transcribe all text following the system instructions.'
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
