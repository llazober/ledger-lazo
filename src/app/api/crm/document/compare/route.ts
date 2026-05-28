import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { extractAndSaveTaxFormData } from '@/lib/ai-processor';
import { compareFields } from '@/lib/pdf-image-verifier';

export async function POST(req: Request) {
  try {
    const { documentId } = await req.json();

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    const pdfDoc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { taxFormData: true }
    });

    if (!pdfDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const baseName = pdfDoc.name.replace(/\.pdf$/i, '');
    
    // Find companion PNGs for this document (ignoring client filter or directory differences)
    let companionDocs = await prisma.document.findMany({
      where: {
        name: {
          startsWith: baseName
        },
        fileType: {
          in: ['PNG', 'JPG', 'JPEG']
        }
      },
      include: { taxFormData: true }
    });

    if (companionDocs.length === 0) {
      return NextResponse.json({
        error: 'No companion verification images found for this PDF. Please ensure page images are generated.'
      }, { status: 400 });
    }

    // Process companion PNGs if they are missing OCR or tax boxes
    for (let comp of companionDocs) {
      let updated = false;
      let text = comp.extractedText;

      if (!text || text.trim().length <= 10) {
        console.log(`[Compare Route] Running GPT-4o Vision OCR on companion PNG ${comp.id}...`);
        
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
                  url: (comp.fileData || '').startsWith('/9j/')
                    ? `data:image/jpeg;base64,${comp.fileData}`
                    : `data:image/png;base64,${comp.fileData}`
                }
              }
            ]
          }],
          max_tokens: 4000
        });

        text = visionResponse.choices[0].message?.content || '';
        await prisma.document.update({
          where: { id: comp.id },
          data: {
            extractedText: text,
            status: 'VALIDATED'
          }
        });
        comp.extractedText = text;
        updated = true;
      }

      if (!comp.taxFormData || updated) {
        console.log(`[Compare Route] Extracting tax form data for companion PNG ${comp.id}...`);
        await extractAndSaveTaxFormData(comp.id, pdfDoc.category, text || '');
      }
    }

    // Refetch companion documents to get updated taxFormData records
    companionDocs = await prisma.document.findMany({
      where: {
        id: {
          in: companionDocs.map(c => c.id)
        }
      },
      include: { taxFormData: true }
    });

    // Consolidate boxes from multiple companion PNG pages
    const consolidatedBoxes: Record<string, any> = {};
    for (const comp of companionDocs) {
      if (comp.taxFormData?.boxes) {
        const boxes = comp.taxFormData.boxes as Record<string, any>;
        for (const key of Object.keys(boxes)) {
          const val = boxes[key];
          if (val !== null && val !== undefined && val !== '' && val !== 0) {
            // Assign if not already assigned or if current value is null/empty/0
            const current = consolidatedBoxes[key];
            if (current === undefined || current === null || current === '' || current === 0) {
              consolidatedBoxes[key] = val;
            }
          }
        }
      }
    }

    // Make sure PDF has taxFormData extracted
    let activePdfDoc = pdfDoc;
    if (!activePdfDoc.taxFormData && activePdfDoc.extractedText) {
      console.log(`[Compare Route] Extracting missing tax form data for PDF ${pdfDoc.id}...`);
      await extractAndSaveTaxFormData(pdfDoc.id, pdfDoc.category, pdfDoc.extractedText || '');
      
      const refetched = await prisma.document.findUnique({
        where: { id: pdfDoc.id },
        include: { taxFormData: true }
      });
      if (refetched) activePdfDoc = refetched;
    }

    const pdfBoxes = (activePdfDoc.taxFormData?.boxes || {}) as Record<string, any>;

    // Perform comparison using same rules as pdf-image-verifier
    const comparison = compareFields(activePdfDoc.category, pdfBoxes, consolidatedBoxes);

    let updatedPdfBoxes = { ...pdfBoxes };
    let hadDiscrepancies = false;
    const actualMismatches: string[] = [];

    // Keys to compare based on form category
    const formLower = activePdfDoc.category.toLowerCase();
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
      const pdfKeys = Object.keys(pdfBoxes);
      const imgKeys = Object.keys(consolidatedBoxes);
      keysToCompare = pdfKeys.filter(k => imgKeys.includes(k)).slice(0, 5);
    }

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

    function normalizeString(val: any): string {
      if (val === null || val === undefined) return '';
      return String(val).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    }

    function normalizeNumeric(val: any): number | null {
      if (val === null || val === undefined || val === '') return null;
      if (typeof val === 'number') return val;
      const parsed = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? null : parsed;
    }

    for (const key of keysToCompare) {
      const pdfVal = pdfBoxes[key];
      const imgVal = consolidatedBoxes[key];

      if (pdfVal === undefined && imgVal === undefined) continue;

      const isNumKey = NUMERIC_FIELDS.includes(key);
      let hasMismatch = false;

      if (isNumKey) {
        const numPdf = normalizeNumeric(pdfVal);
        const numImg = normalizeNumeric(imgVal);

        if (numPdf === null && numImg === null) continue;
        if (numPdf === null || numImg === null) {
          hasMismatch = true;
        } else if (Math.abs(numPdf - numImg) >= 0.01) {
          hasMismatch = true;
        }
      } else {
        const cleanPdf = normalizeString(pdfVal);
        const cleanImg = normalizeString(imgVal);

        const isSsnOrEin = key.toLowerCase().includes('ssn') || key.toLowerCase().includes('ein') || key.toLowerCase().includes('tin');
        if (isSsnOrEin && (cleanPdf.includes('x') || cleanPdf.includes('*') || cleanImg.includes('x') || cleanImg.includes('*'))) {
          const last4Pdf = cleanPdf.slice(-4);
          const last4Img = cleanImg.slice(-4);
          if (last4Pdf !== last4Img) {
            hasMismatch = true;
          }
        } else {
          if (cleanPdf !== cleanImg) {
            hasMismatch = true;
          }
        }
      }

      if (hasMismatch) {
        actualMismatches.push(key);
        // Correct PDF value using consolidated PNG value
        updatedPdfBoxes[key] = imgVal;
        hadDiscrepancies = true;
      }
    }

    // Save updated boxes back to PDF document
    if (hadDiscrepancies || !activePdfDoc.taxFormData) {
      await prisma.taxFormData.upsert({
        where: { documentId: activePdfDoc.id },
        update: {
          boxes: updatedPdfBoxes
        },
        create: {
          documentId: activePdfDoc.id,
          formType: activePdfDoc.category,
          boxes: updatedPdfBoxes
        }
      });
    }

    // Set PDF document status to VALIDATED and clear validationErrors
    const updatedPdf = await prisma.document.update({
      where: { id: activePdfDoc.id },
      data: {
        status: 'VALIDATED',
        validationErrors: null
      },
      include: { taxFormData: true }
    });

    return NextResponse.json({
      success: true,
      hadDiscrepancies,
      mismatches: actualMismatches,
      document: updatedPdf
    });

  } catch (err: any) {
    console.error('[Compare API Route Error]:', err);
    return NextResponse.json({ error: err.message || 'Comparison failed' }, { status: 500 });
  }
}
