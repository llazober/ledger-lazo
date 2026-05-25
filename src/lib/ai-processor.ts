import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';

/**
 * Splits extracted document text into chunks and generates OpenAI vector embeddings
 * for RAG search. Deletes any existing chunks for the document first to prevent duplicates.
 */
export async function processDocumentChunks(documentId: string, text: string) {
  try {
    console.log(`[RAG Indexer] Processing document chunks for ${documentId}...`);

    // 1. Delete any existing chunks for this document (allows clean re-indexing/updates)
    await prisma.documentChunk.deleteMany({
      where: { documentId }
    });

    if (!text || text.trim() === '') {
      console.log(`[RAG Indexer] Document ${documentId} has no text. Skipping chunking.`);
      return { success: true, count: 0 };
    }

    // 2. Chunking (1000 chars with 200 chars overlap)
    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];

    // Safety guard to avoid infinite loop if overlap is larger than or equal to chunkSize
    const step = chunkSize - overlap <= 0 ? chunkSize : chunkSize - overlap;

    for (let i = 0; i < text.length; i += step) {
      const chunk = text.slice(i, i + chunkSize);
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    console.log(`[RAG Indexer] Split document ${documentId} into ${chunks.length} chunks.`);

    // 3. Generate embeddings and save to database
    const hasOpenAI = process.env.OPENAI_API_KEY && 
                      process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                      process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

    if (!hasOpenAI) {
      console.warn(`[RAG Indexer] OpenAI API Key is missing. Creating chunks WITHOUT embeddings.`);
      
      // Save chunks without embedding array
      for (const chunkContent of chunks) {
        await prisma.documentChunk.create({
          data: {
            documentId,
            content: chunkContent,
          }
        });
      }
      return { success: true, count: chunks.length, embedded: false };
    }

    // Create chunks with OpenAI embeddings
    for (const chunkContent of chunks) {
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: chunkContent,
        });

        const embedding = response.data[0].embedding;

        await prisma.documentChunk.create({
          data: {
            documentId,
            content: chunkContent,
            embedding: embedding as number[], // Saved as JSON array of numbers
          }
        });
      } catch (embErr) {
        console.error(`[RAG Indexer] Failed to generate embedding for a chunk of document ${documentId}:`, embErr);
        // Fallback: save chunk without embedding rather than failing the whole flow
        await prisma.documentChunk.create({
          data: {
            documentId,
            content: chunkContent,
          }
        });
      }
    }

    console.log(`[RAG Indexer] Indexed ${chunks.length} chunks for document ${documentId}.`);
    return { success: true, count: chunks.length, embedded: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[RAG Indexer] Error chunking/embedding document ${documentId}:`, errorMessage);
    throw error;
  }
}

/**
 * Extracts fields from dynamic tax forms (W-2, 1099s) from document text using OpenAI 
 * and saves it in the TaxFormData table.
 * If the record already exists, it updates it; otherwise it creates it.
 */
export async function extractAndSaveTaxFormData(documentId: string, formType: string, text: string) {
  try {
    console.log(`[TaxForm Extractor] Extracting fields for documentId: ${documentId}, formType: ${formType}...`);
    
    if (!text || text.trim() === '') {
      console.log(`[TaxForm Extractor] Document ${documentId} has no text content. Skipping extraction.`);
      return { success: false, error: 'No text content' };
    }

    const hasOpenAI = process.env.OPENAI_API_KEY && 
                      process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                      process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

    if (!hasOpenAI) {
      console.warn(`[TaxForm Extractor] OpenAI API Key is missing. Skipping AI extraction.`);
      return { success: false, error: 'API key missing' };
    }

    // Fetch document details to check for image data
    const doc = await prisma.document.findUnique({
      where: { id: documentId }
    });

    const isImage = doc && doc.fileData && 
                    ['png', 'jpg', 'jpeg', 'webp'].includes(doc.fileType?.toLowerCase() || '');

    // Determine the specific prompts and JSON schemas depending on the form type
    let promptInstructions = '';
    let jsonSchemaKeysDescription = '';
    
    const lowerFormType = formType.toLowerCase();

    if (lowerFormType.includes('w2') || lowerFormType.includes('w-2')) {
      promptInstructions = `
Extract the values for the following boxes:
- Box a: Employee's Social Security Number (employeeSsn) -> Format as string (e.g. "XXX-XX-XXXX"). Look for label "a" or "Employee's social security number".
- Box b: Employer Identification Number (employerEin) -> Format as string (e.g. "XX-XXXXXXX"). Look for label "b" or "Employer identification number (EIN)".
- Box 1: Wages, tips, other compensation (wages) -> Numeric value (float or integer). Look for label "1" or "Wages, tips, other compensation".
- Box 2: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer). Look for label "2" or "Federal income tax withheld". Typically, this is a significant portion of wages (e.g. 10% - 30% of Box 1) and is completely different from Box 6.
- Box 3: Social security wages (socialSecurityWages) -> Numeric value (float or integer). Look for label "3" or "Social security wages".
- Box 4: Social security tax withheld (socialSecurityTax) -> Numeric value (float or integer). Look for label "4" or "Social security tax withheld".
- Box 5: Medicare wages and tips (medicareWages) -> Numeric value (float or integer). Look for label "5" or "Medicare wages and tips".
- Box 6: Medicare tax withheld (medicareTax) -> Numeric value (float or integer). Look for label "6" or "Medicare tax withheld". Usually a much smaller amount (1.45% of wages).

**Layout Rules & Column Resolution**:
W-2 forms are arranged in side-by-side columns:
- Box 1 (Wages) is next to Box 2 (Federal income tax). 
- Box 3 (SS Wages) is next to Box 4 (SS Tax).
- Box 5 (Medicare Wages) is next to Box 6 (Medicare Tax).

When standard OCR transcribes the text horizontally line-by-line, it typically reads:
"[Label Box 1] [Label Box 2] [Value Box 1] [Value Box 2]" 
For example: "1 Wages, tips, other comp. 2 Federal income tax withheld 93818.21 13221.63".
- You MUST map the first number (e.g. 93818.21) to Box 1 (wages).
- You MUST map the second number (e.g. 13221.63) to Box 2 (fedIncomeTax).
- Do NOT skip the Box 2 value or copy the Box 6 value (e.g. 1360.36) into Box 2.

Apply this same relative column alignment mapping for Box 3 & 4, and Box 5 & 6:
- For "3 Social security wages 4 Social security tax withheld 93818.21 5816.73", Box 3 is 93818.21 and Box 4 is 5816.73.
- For "5 Medicare wages and tips 6 Medicare tax withheld 93818.21 1360.36", Box 5 is 93818.21 and Box 6 is 1360.36.

**Duplicate Prevention**: A single page/sheet may contain multiple copies of the same W-2 form (e.g., Copy B, Copy C, Copy 2, Copy D). Identify if copies are present and extract only ONE unified set of values representing the form (do not duplicate or combine numeric fields, just extract from a single legible copy).
`;
      jsonSchemaKeysDescription = `"employeeSsn", "employerEin", "wages", "fedIncomeTax", "socialSecurityWages", "socialSecurityTax", "medicareWages", "medicareTax"`;
    } else if (lowerFormType.includes('1099-nec')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1099-NEC:
- Payer's TIN/Employer Identification Number (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Recipient's TIN/SSN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 1: Nonemployee compensation (nonemployeeCompensation) -> Numeric value (float or integer). Look for label "1" or "Nonemployee compensation".
- Box 4: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer). Look for label "4" or "Federal income tax withheld".
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "nonemployeeCompensation", "fedIncomeTax"`;
    } else if (lowerFormType.includes('1099-misc')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1099-MISC:
- Payer's TIN/Employer Identification Number (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Recipient's TIN/SSN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 1: Rents (rents) -> Numeric value (float or integer).
- Box 2: Royalties (royalties) -> Numeric value (float or integer).
- Box 3: Other income (otherIncome) -> Numeric value (float or integer).
- Box 4: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer).
- Box 8: Substitute payments in lieu of dividends or interest (substitutePayments) -> Numeric value (float or integer).
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "rents", "royalties", "otherIncome", "fedIncomeTax", "substitutePayments"`;
    } else if (lowerFormType.includes('1099-int')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1099-INT:
- Payer's TIN/Employer Identification Number (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Recipient's TIN/SSN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 1: Interest income (interestIncome) -> Numeric value (float or integer).
- Box 4: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer).
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "interestIncome", "fedIncomeTax"`;
    } else if (lowerFormType.includes('1099-div')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1099-DIV:
- Payer's TIN/Employer Identification Number (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Recipient's TIN/SSN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 1a: Total ordinary dividends (totalOrdinaryDividends) -> Numeric value (float or integer).
- Box 1b: Qualified dividends (qualifiedDividends) -> Numeric value (float or integer).
- Box 2a: Total capital gain dist. (totalCapitalGainDist) -> Numeric value (float or integer).
- Box 4: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer).
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "totalOrdinaryDividends", "qualifiedDividends", "totalCapitalGainDist", "fedIncomeTax"`;
    } else if (lowerFormType.includes('1099-ssa') || lowerFormType.includes('ssa-1099')) {
      promptInstructions = `
Extract the values for the following boxes of Form SSA-1099 (Social Security Benefit Statement):
- Box 3: Benefits paid (benefitsPaid) -> Numeric value (float or integer).
- Box 4: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer).
- Box 5: Net benefits (netBenefits) -> Numeric value (float or integer).
- Payer's TIN/EIN (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Recipient's SSN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "benefitsPaid", "fedIncomeTax", "netBenefits"`;
    } else if (lowerFormType.includes('1099') || lowerFormType.includes('unclassified') || lowerFormType.includes('other')) {
      promptInstructions = `
This is a general or unclassified Form ${formType}.
Extract all numbered or lettered boxes (e.g. Box 1, Box 2a, Box 3, Box 14, Box 16, etc.) present on the form.
For your JSON output:
- Standardize the keys by camelCasing the label (e.g. 'box1', 'box2a', 'box3', 'payerEin', 'recipientSsn', 'grossDistribution', 'federalIncomeTaxWithheld').
- Only extract boxes that are clearly labeled on the form.
`;
      jsonSchemaKeysDescription = `any dynamic camelCase keys representing the form boxes found (e.g. "payerEin", "recipientSsn", "box1", "box2")`;
    } else {
      console.log(`[TaxForm Extractor] Form type "${formType}" is not supported for key boxes extraction. Skipping.`);
      return { success: true, message: 'Unrecognized tax form type for box extraction' };
    }

    const prompt = `You are an expert CPA Tax Assistant. 
Extract key tax data for Form Type: "${formType}" from this document. 

OCR Text Content (if available):
---
${text}
---

Your task:
${promptInstructions}

If a value is missing, set it to null. Do not guess TIN/SSN/EIN values; only extract them if present and recognizable.
Ensure all monetary amounts are represented as clean numbers (do not include currency symbols or commas in the values, just numbers).

Format your output as a JSON object with these exact keys:
${jsonSchemaKeysDescription}`;

    let messages: any[] = [];
    if (isImage && doc?.fileData) {
      console.log(`[TaxForm Extractor] Document ${documentId} is an image. Using Vision API to increase extraction accuracy (especially for Box 2 and layout grids).`);
      const fileExt = doc.fileType.toLowerCase();
      const mimeType = fileExt === 'jpg' || fileExt === 'jpeg' ? 'image/jpeg' : `image/${fileExt}`;
      messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${doc.fileData}`
              }
            }
          ]
        }
      ];
    } else {
      console.log(`[TaxForm Extractor] Utilizing standard Text API...`);
      messages = [
        {
          role: 'user',
          content: prompt
        }
      ];
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: "json_object" }
    });

    const parsedData = JSON.parse(response.choices[0].message?.content || '{}');

    // Clean up numerical floats and strings
    const cleanFloat = (val: any): number | null => {
      if (val === undefined || val === null || val === '') return null;
      if (typeof val === 'number') return val;
      const parsed = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? null : parsed;
    };

    const cleanStr = (val: any): string | null => {
      if (val === undefined || val === null || val === '') return null;
      return String(val).trim();
    };

    const cleanedBoxes: Record<string, any> = {};
    for (const key of Object.keys(parsedData)) {
      const val = parsedData[key];
      if (key === 'employeeSsn' || key === 'employerEin' || key === 'payerEin' || key === 'recipientSsn') {
        cleanedBoxes[key] = cleanStr(val);
      } else {
        cleanedBoxes[key] = cleanFloat(val);
      }
    }

    console.log(`[TaxForm Extractor] Cleaned extracted boxes for document ${documentId}:`, cleanedBoxes);

    // Save or update in database
    const taxFormRecord = await prisma.taxFormData.upsert({
      where: { documentId },
      update: {
        formType,
        boxes: cleanedBoxes
      },
      create: {
        documentId,
        formType,
        boxes: cleanedBoxes
      }
    });

    return { success: true, data: taxFormRecord };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[TaxForm Extractor] Error extracting tax form data for document ${documentId}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}
