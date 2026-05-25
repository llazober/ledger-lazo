import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Performs high-fidelity Vision OCR on a PDF document by uploading it to the OpenAI Files API
 * and running Chat Completions with the file_id. The file is guaranteed to be deleted after use.
 * 
 * @param fileBuffer The raw buffer of the PDF file.
 * @param filename The name of the file.
 * @returns The transcribed text content from the PDF.
 */
export async function performVisionOcrWithFilesApi(fileBuffer: Buffer, filename: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured in the environment.');
  }

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
1. Capture the FORM TYPE exactly (e.g. "Form 1099-NEC", "Form W-2", "Form 1099-MISC")
2. Capture every box NUMBER and its LABEL and its DOLLAR VALUE on the same line
   Example: "Box 1 Nonemployee compensation: 1600.00"
3. Capture Payer name, Payer TIN/EIN, Recipient name, Recipient TIN/SSN.
   NOTE: On all Form 1099 variants, "PAYER'S TIN" is in the left box and "RECIPIENT'S TIN" is in the right box. Ensure the LEFT value is mapped to Payer's TIN/EIN, and the RIGHT value is mapped to Recipient's TIN/SSN. Do not swap them.
4. Do NOT summarize. Transcribe the actual text exactly as printed.
5. If multiple copies of the same form appear (Copy B, Copy C), transcribe only ONE copy.`
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
    return resultText;
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
