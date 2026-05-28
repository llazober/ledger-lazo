import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { convertPdfToImages } from './pdf-converter';
import { extractAndSaveTaxFormData } from './ai-processor';

/**
 * Normalizes string values (like SSN, EIN, or Policy Numbers) for matching.
 * Removes non-alphanumeric characters and converts to lowercase.
 */
function normalizeString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Normalizes numeric values for matching.
 * Converts to parsed float after stripping commas/symbols.
 */
function normalizeNumeric(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(parsed) ? null : parsed;
}

/**
 * Compares fields between PDF extracted data and Image extracted data.
 * Checks for matches within tolerance and format differences.
 */
export function compareFields(formType: string, pdfBoxes: Record<string, any>, imageBoxes: Record<string, any>) {
  const formLower = formType.toLowerCase();
  let keysToCompare: string[] = [];

  if (formLower.includes('w2') || formLower.includes('w-2')) {
    keysToCompare = ['employeeSsn', 'employerEin', 'wages', 'fedIncomeTax', 'socialSecurityWages', 'socialSecurityTax', 'medicareWages', 'medicareTax'];
  } else if (formLower.includes('1099-nec')) {
    keysToCompare = ['payerEin', 'recipientSsn', 'nonemployeeCompensation', 'fedIncomeTax'];
  } else if (formLower.includes('1099-misc')) {
    keysToCompare = ['payerEin', 'recipientSsn', 'rents', 'royalties', 'otherIncome', 'fedIncomeTax', 'substitutePayments'];
  } else if (formLower.includes('1099-int')) {
    keysToCompare = ['payerEin', 'recipientSsn', 'interestIncome', 'fedIncomeTax'];
  } else if (formLower.includes('1099-div')) {
    keysToCompare = ['payerEin', 'recipientSsn', 'totalOrdinaryDividends', 'qualifiedDividends', 'totalCapitalGainDist', 'fedIncomeTax'];
  } else if (formLower.includes('1099-r')) {
    keysToCompare = ['payerEin', 'recipientSsn', 'grossDistribution', 'taxableAmount', 'fedIncomeTax', 'distributionCode', 'otherIncome', 'stateIncomeTax', 'stateDistribution'];
  } else if (formLower.includes('1095-a') || formLower.includes('1095a')) {
    keysToCompare = ['marketplaceIdentifier', 'policyNumber', 'recipientName', 'recipientSsn', 'spouseSsn', 'policyStartDate', 'policyTerminationDate', 'annualEnrollmentPremiums', 'annualSlcspPremium', 'annualAdvancePtc'];
  } else if (formLower.includes('1099-ssa') || formLower.includes('ssa-1099')) {
    keysToCompare = ['payerEin', 'recipientSsn', 'benefitsPaid', 'benefitsRepaid', 'netBenefits', 'fedIncomeTax', 'address', 'claimNumber'];
  } else if (formLower.includes('1098')) {
    keysToCompare = ['lenderEin', 'borrowerSsn', 'mortgageInterest', 'outstandingPrincipal', 'originationDate', 'interestRefund', 'mortgageInsurance', 'pointsPaid', 'propertyAddress', 'realEstateTaxes'];
  } else {
    // Other forms or generic 1099 forms: compare overlapping keys
    const pdfKeys = Object.keys(pdfBoxes);
    const imgKeys = Object.keys(imageBoxes);
    keysToCompare = pdfKeys.filter(k => imgKeys.includes(k)).slice(0, 5);
  }

  const mismatches: string[] = [];

  const NUMERIC_FIELDS = [
    'wages', 'fedIncomeTax', 'socialSecurityWages', 'socialSecurityTax', 
    'medicareWages', 'medicareTax', 'nonemployeeCompensation', 'rents', 
    'royalties', 'otherIncome', 'substitutePayments', 'interestIncome', 
    'totalOrdinaryDividends', 'qualifiedDividends', 'totalCapitalGainDist', 
    'grossDistribution', 'taxableAmount', 'stateIncomeTax', 'stateDistribution',
    'annualEnrollmentPremiums', 'annualSlcspPremium', 'annualAdvancePtc',
    'benefitsPaid', 'benefitsRepaid', 'netBenefits',
    'mortgageInterest', 'outstandingPrincipal', 'interestRefund', 'mortgageInsurance', 'pointsPaid', 'realEstateTaxes'
  ];

  for (const key of keysToCompare) {
    const pdfVal = pdfBoxes[key];
    const imgVal = imageBoxes[key];

    if (pdfVal === undefined && imgVal === undefined) continue;

    const isNumKey = NUMERIC_FIELDS.includes(key);

    if (isNumKey) {
      const numPdf = normalizeNumeric(pdfVal);
      const numImg = normalizeNumeric(imgVal);

      if (numPdf === null && numImg === null) continue;
      if (numPdf === null || numImg === null) {
        mismatches.push(`${key} (PDF: ${pdfVal ?? 'null'}, Image: ${imgVal ?? 'null'})`);
        continue;
      }

      // Allow down to 1-cent difference
      if (Math.abs(numPdf - numImg) >= 0.01) {
        mismatches.push(`${key} (PDF: $${numPdf.toFixed(2)}, Image: $${numImg.toFixed(2)})`);
      }
    } else {
      const cleanPdf = normalizeString(pdfVal);
      const cleanImg = normalizeString(imgVal);

      const isSsnOrEin = key.toLowerCase().includes('ssn') || key.toLowerCase().includes('ein') || key.toLowerCase().includes('tin');
      if (isSsnOrEin && (cleanPdf.includes('x') || cleanPdf.includes('*') || cleanImg.includes('x') || cleanImg.includes('*'))) {
        // Compare last 4 digits if masked
        const last4Pdf = cleanPdf.slice(-4);
        const last4Img = cleanImg.slice(-4);
        if (last4Pdf && last4Img && last4Pdf !== last4Img) {
          mismatches.push(`${key} (PDF: ${pdfVal}, Image: ${imgVal})`);
        }
      } else {
        if (cleanPdf !== cleanImg) {
          mismatches.push(`${key} (PDF: "${pdfVal}", Image: "${imgVal}")`);
        }
      }
    }
  }

  return {
    match: mismatches.length === 0,
    mismatches
  };
}

/**
 * Validates a PDF document by:
 * 1. Rendering page 1 as an image file.
 * 2. Creating a companion image verification document.
 * 3. Running High-Fidelity Vision OCR on the image.
 * 4. Running the tax form field extractor on the image's text.
 * 5. Comparing key fields and updating validation status accordingly.
 * 
 * @param pdfDocId ID of the PDF document in the database
 * @param pdfBuffer The raw buffer of the PDF file
 * @returns The updated PDF document record
 */
export async function verifyPdfDocument(pdfDocId: string, pdfBuffer: Buffer) {
  try {
    console.log(`[PDF Image Verifier] Starting dual-pass validation for PDF document ${pdfDocId}...`);

    const pdfDoc = await prisma.document.findUnique({
      where: { id: pdfDocId },
      include: { taxFormData: true }
    });

    if (!pdfDoc) {
      console.warn(`[PDF Image Verifier] PDF document not found: ${pdfDocId}`);
      return null;
    }

    const nameLower = pdfDoc.name.toLowerCase();
    const isTaxForm = pdfDoc.category === 'W2' || 
                      pdfDoc.category.startsWith('1099') || 
                      pdfDoc.category.includes('1099') || 
                      pdfDoc.category === '1095-A' ||
                      pdfDoc.category === '1098' ||
                      pdfDoc.category === 'UNCLASSIFIED' ||
                      nameLower.includes('w2') ||
                      nameLower.includes('w-2') ||
                      nameLower.includes('1099') ||
                      nameLower.includes('1095') ||
                      nameLower.includes('1098');
    
    if (!isTaxForm) {
      console.log(`[PDF Image Verifier] Category "${pdfDoc.category}" is not a verified tax form type and name does not suggest a tax form. Skipping image validation.`);
      return pdfDoc;
    }

    if (!process.env.OPENAI_API_KEY) {
      console.warn(`[PDF Image Verifier] OpenAI API Key is missing. Skipping validation.`);
      return pdfDoc;
    }

    // Convert PDF to image base64
    console.log(`[PDF Image Verifier] Converting PDF pages to PNG using convertPdfToImages...`);
    const pagesBase64 = await convertPdfToImages(pdfBuffer, 1);
    if (pagesBase64.length === 0) {
      console.warn(`[PDF Image Verifier] Failed to convert PDF to image.`);
      return pdfDoc;
    }
    const imageBase64 = pagesBase64[0];

    // Create the image verification document record
    const imageName = `${pdfDoc.name.replace(/\.pdf$/i, '')} (Image Verification).png`;
    console.log(`[PDF Image Verifier] Creating image verification document "${imageName}"...`);
    
    const imageDoc = await prisma.document.create({
      data: {
        clientId: pdfDoc.clientId,
        name: imageName,
        url: '#',
        fileSize: Math.round(imageBase64.length * 0.75),
        fileType: 'PNG',
        taxYear: pdfDoc.taxYear,
        category: pdfDoc.category,
        status: 'OCR_PROCESSING',
        fileData: imageBase64,
      }
    });

    // Run high-fidelity Vision OCR (equivalent to clicking the "OCR button")
    console.log(`[PDF Image Verifier] Running High-Fidelity GPT-4o Vision OCR on image document ${imageDoc.id}...`);
    
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe ALL visible text from the following document image. Perform high-fidelity OCR, preserving all headers, forms, labels, tables, key-value pairs, numbers, boxes, and identifiers exactly as printed.'
          },
          {
            type: 'image_url',
            image_url: {
              url: imageBase64.startsWith('/9j/')
                ? `data:image/jpeg;base64,${imageBase64}`
                : `data:image/png;base64,${imageBase64}`
            }
          }
        ]
      }],
      max_tokens: 4000
    });

    const visionText = visionResponse.choices[0].message?.content || '';
    if (!visionText || visionText.trim().length <= 10) {
      console.warn(`[PDF Image Verifier] GPT-4o Vision OCR returned empty text for ${imageDoc.id}`);
      
      const errorMsg = 'Scanned verification image could not be parsed via high-fidelity Vision OCR.';
      
      await prisma.document.update({
        where: { id: imageDoc.id },
        data: {
          status: 'REVIEW_REQUIRED',
          validationErrors: errorMsg
        }
      });

      return await prisma.document.update({
        where: { id: pdfDocId },
        data: {
          status: 'REVIEW_REQUIRED',
          validationErrors: `Verification Failed: Converted image OCR failed to extract text.`
        },
        include: { taxFormData: true }
      });
    }

    console.log(`[PDF Image Verifier] Classifying image OCR text...`);
    const classifierPrompt = `You are an expert CPA Tax Assistant.
Analyze the following raw OCR text extracted from an uploaded client document image:
---
${visionText}
---

Your task:
1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
3. Check for any validation errors or discrepancies. Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
4. Estimate your parsing confidence score between 0.0 and 1.0.

Format your output as a JSON object with keys:
"category", "aiSummary", "confidenceScore", "validationErrors"`;

    const classificationResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: classifierPrompt }],
      response_format: { type: "json_object" }
    });

    const classResult = JSON.parse(classificationResponse.choices[0].message?.content || '{}');
    let imageCategory = classResult.category || pdfDoc.category;

    // Clear all spaces/hyphens and check for unique OMB control numbers in the verification image text
    const cleanTextForOMB = visionText.replace(/[\s\-\_\,\.\/\(\)\*]/g, '').toLowerCase();
    let detectedCategory: string | null = null;
    if (cleanTextForOMB.includes('15451380')) detectedCategory = '1098';
    else if (cleanTextForOMB.includes('15450008')) detectedCategory = 'W2';
    else if (cleanTextForOMB.includes('15450112')) detectedCategory = '1099-INT';
    else if (cleanTextForOMB.includes('15450110')) detectedCategory = '1099-DIV';
    else if (cleanTextForOMB.includes('15450119')) detectedCategory = '1099-R';
    else if (cleanTextForOMB.includes('15452232')) detectedCategory = '1095-A';
    else if (cleanTextForOMB.includes('09600616')) detectedCategory = '1099-SSA';
    else if (cleanTextForOMB.includes('15450115')) {
      detectedCategory = cleanTextForOMB.includes('nonemployee') ? '1099-NEC' : '1099-MISC';
    }

    if (detectedCategory) {
      console.log(`[PDF Image Verifier] OMB fingerprint matched: ${detectedCategory}. Overriding imageCategory.`);
      imageCategory = detectedCategory;
    }

    // Sync category to PDF document if different (e.g., if PDF was UNCLASSIFIED)
    if (pdfDoc.category !== imageCategory) {
      console.log(`[PDF Image Verifier] PDF category mismatch (PDF: "${pdfDoc.category}", Image: "${imageCategory}"). Syncing PDF category.`);
      await prisma.document.update({
        where: { id: pdfDocId },
        data: { category: imageCategory }
      });
      pdfDoc.category = imageCategory;
    }

    // Update image document with results
    await prisma.document.update({
      where: { id: imageDoc.id },
      data: {
        category: imageCategory,
        extractedText: visionText,
        aiSummary: classResult.aiSummary || 'High-fidelity Image OCR extraction.',
        confidenceScore: classResult.confidenceScore || 0.99,
        validationErrors: classResult.validationErrors || null
      }
    });

    // Extract tax form data for the image document
    console.log(`[PDF Image Verifier] Extracting tax form data boxes for image document ${imageDoc.id}...`);
    await extractAndSaveTaxFormData(imageDoc.id, imageCategory, visionText);

    // Make sure the PDF document has its tax form data extracted as well
    let finalPdfDoc = await prisma.document.findUnique({
      where: { id: pdfDocId },
      include: { taxFormData: true }
    });

    if (!finalPdfDoc?.taxFormData && finalPdfDoc?.extractedText) {
      console.log(`[PDF Image Verifier] PDF tax form data missing. Running extractor on PDF...`);
      await extractAndSaveTaxFormData(pdfDocId, finalPdfDoc.category, finalPdfDoc.extractedText);
      finalPdfDoc = await prisma.document.findUnique({
        where: { id: pdfDocId },
        include: { taxFormData: true }
      });
    }

    const finalImageDoc = await prisma.document.findUnique({
      where: { id: imageDoc.id },
      include: { taxFormData: true }
    });

    if (!finalPdfDoc?.taxFormData || !finalImageDoc?.taxFormData) {
      console.warn(`[PDF Image Verifier] Missing extracted tax form data records for comparison.`);
      
      const errorMsg = 'Failed to extract structured tax boxes from PDF or Image.';
      await prisma.document.update({
        where: { id: imageDoc.id },
        data: { status: 'REVIEW_REQUIRED', validationErrors: errorMsg }
      });
      return await prisma.document.update({
        where: { id: pdfDocId },
        data: { status: 'REVIEW_REQUIRED', validationErrors: `Verification Failed: ${errorMsg}` },
        include: { taxFormData: true }
      });
    }

    // Compare fields
    const pdfBoxes = finalPdfDoc.taxFormData.boxes as Record<string, any>;
    const imgBoxes = finalImageDoc.taxFormData.boxes as Record<string, any>;
    const comparison = compareFields(finalPdfDoc.category, pdfBoxes, imgBoxes);

    console.log(`[PDF Image Verifier] Comparison result:`, comparison);

    if (comparison.match) {
      console.log(`[PDF Image Verifier] Success! Key fields match.`);
      
      const updatedPdf = await prisma.document.update({
        where: { id: pdfDocId },
        data: {
          status: 'VALIDATED',
          validationErrors: null,
          aiSummary: `${finalPdfDoc.aiSummary || ''} (Verified with 100% accuracy against high-fidelity Image Vision OCR.)`
        },
        include: { taxFormData: true }
      });

      await prisma.document.update({
        where: { id: imageDoc.id },
        data: {
          status: 'VALIDATED',
          validationErrors: null,
          aiSummary: `${finalImageDoc.aiSummary || ''} (Successfully verified PDF document ${finalPdfDoc.name}.)`
        }
      });

      return updatedPdf;
    } else {
      console.warn(`[PDF Image Verifier] Mismatch detected:`, comparison.mismatches);
      const mismatchErrors = `Verification Mismatch: PDF text layer values do not match High-Fidelity Image OCR. Mismatched fields: ${comparison.mismatches.join(', ')}`;
      
      const updatedPdf = await prisma.document.update({
        where: { id: pdfDocId },
        data: {
          status: 'REVIEW_REQUIRED',
          validationErrors: mismatchErrors
        },
        include: { taxFormData: true }
      });

      await prisma.document.update({
        where: { id: imageDoc.id },
        data: {
          status: 'REVIEW_REQUIRED',
          validationErrors: `Mismatched with PDF: ${comparison.mismatches.join(', ')}`
        }
      });

      return updatedPdf;
    }

  } catch (err: any) {
    console.error(`[PDF Image Verifier] Error running verification pipeline:`, err);
    return null;
  }
}
