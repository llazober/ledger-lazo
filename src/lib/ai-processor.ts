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
    } else if (lowerFormType.includes('1099-r')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1099-R:
- Payer's TIN/Employer Identification Number (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Recipient's TIN/SSN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 1: Gross Distribution (grossDistribution) -> Numeric value (float or integer).
- Box 2a: Taxable Amount (taxableAmount) -> Numeric value (float or integer).
- Box 4: Federal Income Tax Withheld (fedIncomeTax) -> Numeric value (float or integer).
- Box 7: Distribution Code (distributionCode) -> Format as string (e.g. "7", "1", "7D", etc.).
- Box 8: Other Income (otherIncome) -> Numeric value (float or integer).
- Box 14: State Tax Withheld (stateIncomeTax) -> Numeric value (float or integer).
- Box 16: State Distribution (stateDistribution) -> Numeric value (float or integer).
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "grossDistribution", "taxableAmount", "fedIncomeTax", "distributionCode", "otherIncome", "stateIncomeTax", "stateDistribution"`;
    } else if (lowerFormType.includes('1095-a') || lowerFormType.includes('1095a')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1095-A (Health Insurance Marketplace Statement):
- Box 1: Marketplace identifier (marketplaceIdentifier) -> String.
- Box 2: Marketplace-assigned policy number (policyNumber) -> String.
- Box 4: Recipient's name (recipientName) -> String.
- Box 5: Recipient's SSN/TIN (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 8: Recipient's spouse's SSN/TIN (spouseSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 10: Policy start date (policyStartDate) -> String (e.g. "MM/DD/YYYY").
- Box 11: Policy termination date (policyTerminationDate) -> String (e.g. "MM/DD/YYYY").
- Box 33A: Monthly enrollment premiums (annualEnrollmentPremiums) -> Numeric value (float or integer) from Row 33 Column A (Annual Totals Column A). Must be extracted from the OCR text "33 Annual Totals: Column A = [value]" (e.g., 12230.40).
- Box 33B: Monthly second lowest cost silver plan (SLCSP) premium (annualSlcspPremium) -> Numeric value (float or integer) from Row 33 Column B (Annual Totals Column B). Must be extracted from the OCR text "33 Annual Totals: Column B = [value]" (e.g., 12610.80).
- Box 33C: Monthly advance payment of premium tax credit (annualAdvancePtc) -> Numeric value (float or integer) from Row 33 Column C (Annual Totals Column C). Must be extracted from the OCR text "33 Annual Totals: Column C = [value]" (e.g., 11472.00).

**Layout & Correlation Rules**:
- Recipient's SSN is in Box 5 (above the spouse section). Spouse's SSN is in Box 8. Do not swap them.
- Read Box 5 and Box 8 with extreme care and do not make OCR typos or shift digits (e.g. "xxx-xx-1490" vs. "xxx-xx-1419").
- In Part III (Coverage Information), Row 33 lists the "Annual Totals" for Column A, Column B, and Column C.
- Column A (Enrollment Premiums) is on the left of the table.
- Column B (Second Lowest Cost Silver Plan / SLCSP) is in the middle of the table.
- Column C (Advance Payment of Premium Tax Credit / APTC) is on the right of the table.
- You MUST map the left value (e.g., 12230.40) to "annualEnrollmentPremiums", the middle value (e.g., 12610.80) to "annualSlcspPremium", and the right value (e.g., 11472.00) to "annualAdvancePtc". Do NOT swap or shift them.
- Do NOT hallucinate covered individuals or spouse SSNs if they are not explicitly present.
`;
      jsonSchemaKeysDescription = `"marketplaceIdentifier", "policyNumber", "recipientName", "recipientSsn", "spouseSsn", "policyStartDate", "policyTerminationDate", "annualEnrollmentPremiums", "annualSlcspPremium", "annualAdvancePtc"`;
    } else if (lowerFormType.includes('1099-ssa') || lowerFormType.includes('ssa-1099')) {
      promptInstructions = `
Extract the values for the following boxes of Form SSA-1099 (Social Security Benefit Statement):
- Payer's TIN/EIN (payerEin) -> Format as string (e.g. "XX-XXXXXXX").
- Box 2: Beneficiary's Social Security Number (recipientSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 3: Benefits paid (benefitsPaid) -> Numeric value (float or integer).
- Box 4: Benefits repaid to SSA (benefitsRepaid) -> Numeric value (float or integer).
- Box 5: Net benefits (netBenefits) -> Numeric value (float or integer).
- Box 6: Voluntary Federal Income Tax Withheld (fedIncomeTax) -> Numeric value (float or integer).
- Box 7: Address (address) -> String.
- Box 8: Claim Number (claimNumber) -> String.
`;
      jsonSchemaKeysDescription = `"payerEin", "recipientSsn", "benefitsPaid", "benefitsRepaid", "netBenefits", "fedIncomeTax", "address", "claimNumber"`;
    } else if (lowerFormType.includes('1098')) {
      promptInstructions = `
Extract the values for the following boxes of Form 1098 (Mortgage Interest Statement):
- Lender's TIN/EIN (lenderEin) -> Format as string (e.g. "XX-XXXXXXX").
- Borrower's TIN/SSN (borrowerSsn) -> Format as string (e.g. "XXX-XX-XXXX").
- Box 1: Mortgage interest received (mortgageInterest) -> Numeric value (float or integer).
- Box 2: Outstanding mortgage principal (outstandingPrincipal) -> Numeric value (float or integer).
- Box 3: Mortgage origination date (originationDate) -> String (e.g. "MM/DD/YYYY").
- Box 4: Refund of overpaid interest (interestRefund) -> Numeric value (float or integer).
- Box 5: Mortgage insurance premiums (mortgageInsurance) -> Numeric value (float or integer).
- Box 6: Points paid for purchase of principal residence (pointsPaid) -> Numeric value (float or integer).
- Box 7: Property address or description (propertyAddress) -> String.
- Box 10: Real estate taxes (realEstateTaxes) -> Numeric value (float or integer).
`;
      jsonSchemaKeysDescription = `"lenderEin", "borrowerSsn", "mortgageInterest", "outstandingPrincipal", "originationDate", "interestRefund", "mortgageInsurance", "pointsPaid", "propertyAddress", "realEstateTaxes"`;
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
${lowerFormType.includes('1099') ? `
**CRITICAL 1099 TIN SWAP PREVENTION RULE**:
On all 1099 forms:
- "payerEin" MUST be the Payer's TIN/EIN (associated with the paying company, e.g., Falcor Engineering Corporation, often starting with NJ/state EIN prefixes like 22- or 44-).
- "recipientSsn" (or "recipientTin") MUST be the Recipient's TIN/SSN (associated with the receiving individual or LLC, e.g., Alexander Loo).
- Note that in raw horizontal OCR, these numbers appear side-by-side: PAYER'S TIN is printed on the LEFT and RECIPIENT'S TIN is printed on the RIGHT. If you see the text line "22-1513100 44-4440062" under "PAYER'S TIN RECIPIENT'S TIN", the LEFT one (22-1513100) is the Payer's EIN, and the RIGHT one (44-4440062) is the Recipient's TIN/SSN. Do NOT swap them!
` : ''}

**CRITICAL DUPLICATE/MULTI-COPY PREVENTION RULE**:
Many tax documents (especially Form 1099s and W-2s) print multiple copies of the exact same form on a single page (e.g. Copy B on the top half and Copy 2 on the bottom half, or multiple identical sections).
You MUST extract values from ONLY ONE copy. Do NOT sum, multiply, double, or combine the dollar values from the different copies or halves. If Box 1 shows 4235.76 in both the top half and bottom half, the Box 1 value is 4235.76, NOT 8471.52.


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

    // Fetch dynamic model choice from settings (default to gpt-4o)
    let extractorModel = 'gpt-4o';
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'global' }
      });
      if (settings?.taxExtractorModel) {
        extractorModel = settings.taxExtractorModel;
      }
    } catch (dbErr) {
      console.warn("[TaxForm Extractor] Could not load dynamic settings for model choice:", dbErr);
    }

    console.log(`[TaxForm Extractor] Calling OpenAI with model: ${extractorModel}`);

    const response = await openai.chat.completions.create({
      model: extractorModel,
      messages,
      response_format: { type: "json_object" }
    });

    // Log token usage to database
    try {
      const usage = response.usage;
      if (usage) {
        const promptTokens = usage.prompt_tokens;
        const completionTokens = usage.completion_tokens;
        const totalTokens = usage.total_tokens;
        const promptRate = extractorModel.includes('mini') ? 0.15 / 1000000 : 2.50 / 1000000;
        const completionRate = extractorModel.includes('mini') ? 0.60 / 1000000 : 10.00 / 1000000;
        const cost = (promptTokens * promptRate) + (completionTokens * completionRate);

        await prisma.tokenUsage.create({
          data: {
            feature: 'OCR & EXTRACTION',
            model: extractorModel,
            promptTokens,
            completionTokens,
            totalTokens,
            cost
          }
        });
      }
    } catch (err) {
      console.warn("[TaxForm Extractor] Failed to log token usage:", err);
    }

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
      if (['employeeSsn', 'employerEin', 'payerEin', 'recipientSsn', 'lenderEin', 'borrowerSsn', 'propertyAddress', 'originationDate', 'spouseSsn', 'policyNumber', 'marketplaceIdentifier', 'policyStartDate', 'policyTerminationDate', 'recipientName', 'distributionCode', 'address', 'claimNumber'].includes(key)) {
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

/**
 * Helper to extract tax year from raw OCR text using regex patterns
 */
export function extractTaxYear(text: string | null | undefined, defaultYear: number = new Date().getFullYear() - 1): number {
  if (!text) return defaultYear;
  
  // Clean whitespace
  const clean = text.replace(/\s+/g, ' ');
  
  // 1. Try to find a year next to OMB number or standard IRS tax form indicators
  // Look for 4-digit years between 2018 and 2030 near form indicators
  const formYearMatch = clean.match(/(?:form\s+w\-2|1099\-[a-z]+|1095\-a|1098)[^0-9]{0,50}(201[8-9]|202[0-9]|203[0-9])/i);
  if (formYearMatch && formYearMatch[1]) {
    return parseInt(formYearMatch[1]);
  }
  
  // 2. Look for year near OMB number patterns
  const ombMatch = clean.match(/omb\s+no\.[^0-9]*\d{4,8}[^0-9]{0,50}(201[8-9]|202[0-9]|203[0-9])/i);
  if (ombMatch && ombMatch[1]) {
    return parseInt(ombMatch[1]);
  }

  // 3. Look for phrases like "tax year 202X" or "for calendar year 202X" or "for year 202X"
  const phraseMatch = clean.match(/(?:tax\s+year|calendar\s+year|for\s+year|statement\s+for|statement\s+year)\s*[^0-9]{0,20}\b(201[8-9]|202[0-9]|203[0-9])\b/i);
  if (phraseMatch && phraseMatch[1]) {
    return parseInt(phraseMatch[1]);
  }
  
  // 4. Fallback: Search for any year in the text
  const yearMatches = clean.match(/\b(201[8-9]|202[0-9]|203[0-9])\b/g);
  if (yearMatches && yearMatches.length > 0) {
    return parseInt(yearMatches[0]);
  }
  
  return defaultYear;
}
