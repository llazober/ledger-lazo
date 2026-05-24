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
 * Extracts W-2 fields from document text using OpenAI and saves it in W2Data table.
 * If the record already exists, it updates it; otherwise it creates it.
 */
export async function extractAndSaveW2Data(documentId: string, text: string) {
  try {
    console.log(`[W2 Extractor] Extracting fields for document ${documentId}...`);
    
    if (!text || text.trim() === '') {
      console.log(`[W2 Extractor] Document ${documentId} has no text content. Skipping extraction.`);
      return { success: false, error: 'No text content' };
    }

    const hasOpenAI = process.env.OPENAI_API_KEY && 
                      process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                      process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

    if (!hasOpenAI) {
      console.warn(`[W2 Extractor] OpenAI API Key is missing. Skipping AI extraction.`);
      return { success: false, error: 'API key missing' };
    }

    const prompt = `You are an expert CPA Tax Assistant. 
Extract the key W-2 form data from the OCR text below. 

Text content:
---
${text}
---

Your task:
Extract the values for the following boxes:
- Box a: Employee's Social Security Number (employeeSsn) -> Format as string (e.g. "XXX-XX-XXXX"). Look for label "a" or "Employee's social security number".
- Box b: Employer Identification Number (employerEin) -> Format as string (e.g. "XX-XXXXXXX"). Look for label "b" or "Employer identification number (EIN)".
- Box 1: Wages, tips, other compensation (wages) -> Numeric value (float or integer). Look for label "1" or "Wages, tips, other compensation".
- Box 2: Federal income tax withheld (fedIncomeTax) -> Numeric value (float or integer). Look for label "2" or "Federal income tax withheld".
- Box 3: Social security wages (socialSecurityWages) -> Numeric value (float or integer). Look for label "3" or "Social security wages".
- Box 4: Social security tax withheld (socialSecurityTax) -> Numeric value (float or integer). Look for label "4" or "Social security tax withheld".
- Box 5: Medicare wages and tips (medicareWages) -> Numeric value (float or integer). Look for label "5" or "Medicare wages and tips".
- Box 6: Medicare tax withheld (medicareTax) -> Numeric value (float or integer). Look for label "6" or "Medicare tax withheld".

If a value is missing, set it to null. Do not guess SSN or EIN values; only extract them if present and recognizable.
Ensure all monetary amounts (Boxes 1-6) are represented as clean numbers (do not include currency symbols or commas in the values, just numbers).

Format your output as a JSON object with these exact keys:
"employeeSsn", "employerEin", "wages", "fedIncomeTax", "socialSecurityWages", "socialSecurityTax", "medicareWages", "medicareTax"`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    });

    const parsedData = JSON.parse(response.choices[0].message?.content || '{}');

    // Prepare data by converting numeric fields to Float
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

    const data = {
      employeeSsn: cleanStr(parsedData.employeeSsn),
      employerEin: cleanStr(parsedData.employerEin),
      wages: cleanFloat(parsedData.wages),
      fedIncomeTax: cleanFloat(parsedData.fedIncomeTax),
      socialSecurityWages: cleanFloat(parsedData.socialSecurityWages),
      socialSecurityTax: cleanFloat(parsedData.socialSecurityTax),
      medicareWages: cleanFloat(parsedData.medicareWages),
      medicareTax: cleanFloat(parsedData.medicareTax),
    };

    console.log(`[W2 Extractor] Extracted W2 data for document ${documentId}:`, data);

    // Save or update in database
    const w2Record = await prisma.w2Data.upsert({
      where: { documentId },
      update: data,
      create: {
        documentId,
        ...data
      }
    });

    return { success: true, data: w2Record };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[W2 Extractor] Error extracting W-2 data for document ${documentId}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}
