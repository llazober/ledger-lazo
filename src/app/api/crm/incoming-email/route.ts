import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { auditClientDocuments } from '@/lib/taxRules';
import { PDFDocument } from 'pdf-lib';
import { processDocumentChunks, extractAndSaveTaxFormData, extractTaxYear } from '@/lib/ai-processor';

const DIRECT_VISION_CLASSIFIER_PROMPT = `
You are an expert tax document classifier. Analyze the provided document image.
1. Identify the official IRS Form number or document type (e.g. "W2", "1099-NEC", "1099-MISC", "1099-INT", "1099-DIV", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", or "UNCLASSIFIED" if it's not one of these).
2. Locate the Tax Year (e.g. 2025, 2024). If not found, return null.
3. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
4. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than 2024 or 2025, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
5. Estimate your classification confidence score between 0.0 and 1.0.

Return a JSON object with this exact structure:
{
  "category": "string",
  "taxYear": number or null,
  "aiSummary": "string",
  "validationErrors": "string" or null,
  "confidenceScore": number
}
`;

// Dynamic document classifier using OpenAI GPT-4o-mini (falls back to regex rules)
async function classifyDocumentWithAI(
  filename: string,
  subject: string,
  bodyText: string
): Promise<{
  category: string;
  aiSummary: string;
  confidenceScore: number;
  validationErrors: string | null;
}> {
  const hasKey = process.env.OPENAI_API_KEY && 
                 process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time' && 
                 process.env.OPENAI_API_KEY !== 'missing_api_key';
                 
  if (!hasKey) {
    return fallbackClassifier(filename);
  }

  try {
    const prompt = `You are an AI assistant for a CPA firm. Your task is to classify an uploaded document based on its metadata.
    
Filename: "${filename}"
Email Subject: "${subject}"
Email Body: "${bodyText}"

Classify it into one of these exact categories: "W2", "1099-NEC", "1099", "1099-INT", "1099-DIV", "1099-R", "1099-MISC", "1099-B", "SSA-1099", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", "Ledger", "Balance_Sheet", "UNCLASSIFIED".
    Note: "1098" is specifically for Mortgage Interest Statements. "1099-INT" is only for Interest Income. "SSA-1099" is for Social Security benefits.

Also, generate a 1-sentence summary of the document based on its name/context.
Provide a confidence score between 0.0 and 1.0.
If there are obvious flags (e.g. filename mentions an old year like 2020, or says "draft" or "unsigned"), explain the issue in validationErrors. Otherwise, set validationErrors to null.

Format your output as a JSON object with keys:
"category", "aiSummary", "confidenceScore", "validationErrors"`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message?.content || '{}');
    return {
      category: result.category || 'UNCLASSIFIED',
      aiSummary: result.aiSummary || 'Document parsed successfully.',
      confidenceScore: result.confidenceScore || 0.8,
      validationErrors: result.validationErrors || null
    };
  } catch (err) {
    console.error("OpenAI document classification failed, falling back:", err);
    return fallbackClassifier(filename);
  }
}

function fallbackClassifier(filename: string) {
  const nameLower = (filename || '').toLowerCase();
  let category = 'UNCLASSIFIED';
  let aiSummary = 'Document uploaded via email.';
  let confidenceScore = 0.7;
  let validationErrors: string | null = null;

  if (nameLower.includes('w2') || nameLower.includes('w-2')) {
    category = 'W2';
    aiSummary = 'W-2 Wage and Tax Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099-int') || nameLower.includes('1099int')) {
    category = '1099-INT';
    aiSummary = '1099-INT Interest Income Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099-div') || nameLower.includes('1099div')) {
    category = '1099-DIV';
    aiSummary = '1099-DIV Dividends and Distributions Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099-r') || nameLower.includes('1099r')) {
    category = '1099-R';
    aiSummary = '1099-R Retirement Distributions Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099-misc') || nameLower.includes('1099misc')) {
    category = '1099-MISC';
    aiSummary = '1099-MISC Miscellaneous Income Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099-b') || nameLower.includes('1099b')) {
    category = '1099-B';
    aiSummary = '1099-B Brokerage Barter Transactions Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099-nec') || nameLower.includes('1099nec')) {
    category = '1099-NEC';
    aiSummary = '1099-NEC Nonemployee Compensation Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1099')) {
    category = '1099';
    aiSummary = '1099 Information Return.';
    confidenceScore = 0.85;
  } else if (nameLower.includes('1095-a') || nameLower.includes('1095a')) {
    category = '1095-A';
    aiSummary = '1095-A Health Insurance Marketplace Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('1098')) {
    category = '1098';
    aiSummary = '1098 Mortgage Interest Statement.';
    confidenceScore = 0.9;
  } else if (nameLower.includes('ssa-1099') || nameLower.includes('ssa1099') || nameLower.includes('social security')) {
    category = 'SSA-1099';
    aiSummary = 'SSA-1099 Social Security Benefit Statement.';
    confidenceScore = 0.9;
  } else if (
    nameLower.includes('bank') || 
    nameLower.includes('statement') || 
    nameLower.includes('checking') || 
    nameLower.includes('savings') || 
    nameLower.includes('stmt')
  ) {
    category = 'Bank_Statement';
    aiSummary = 'Bank checking/savings statement.';
    confidenceScore = 0.85;
  } else if (nameLower.includes('receipt') || nameLower.includes('invoice')) {
    category = 'Receipt';
    aiSummary = 'Expense receipt or vendor invoice.';
    confidenceScore = 0.8;
  } else if (nameLower.includes('ledger') || nameLower.includes('journal')) {
    category = 'Ledger';
    aiSummary = 'General ledger / accounting log.';
    confidenceScore = 0.8;
  } else if (nameLower.includes('balance') || nameLower.includes('sheet')) {
    category = 'Balance_Sheet';
    aiSummary = 'Corporate Balance Sheet statement.';
    confidenceScore = 0.85;
  } else if (nameLower.includes('notice') || nameLower.includes('irs') || nameLower.includes('letter')) {
    category = 'Tax_Notice';
    aiSummary = 'IRS or state tax agency notice letter.';
    confidenceScore = 0.8;
  }

  return { category, aiSummary, confidenceScore, validationErrors };
}

// Webhook Handler for Incoming Emails (from n8n)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { fromEmail, fromName, subject, bodyText, attachments } = body;

    if (!fromEmail) {
      return NextResponse.json({ success: false, error: "fromEmail is required" }, { status: 400 });
    }

    // Clean and normalize email address
    let cleanEmail = fromEmail.trim().toLowerCase();
    const emailMatch = cleanEmail.match(/<([^>]+)>/);
    if (emailMatch) {
      cleanEmail = emailMatch[1].trim().toLowerCase();
    }

    const emailSubject = subject || '';
    const emailBody = bodyText || '';

    // 1. Find or auto-provision User and Client
    let user = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });

    let onboardedNewUser = false;

    if (!user) {
      // Auto-create User profile
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          name: fromName || cleanEmail.split('@')[0],
          passwordHash: "$2b$10$vN9m21U1qC24V4z87V5MJuN1qC24V4z87V5MJuNz39281nS1z.dKe", // Mock temp password
          role: 'CLIENT_USER',
          isActive: true
        }
      });
      onboardedNewUser = true;
    }

    let client = await prisma.client.findUnique({
      where: { userId: user.id }
    });

    if (!client) {
      // Deduce tax type from subject/body context (default to 1040)
      let taxType = '1040';
      const textToSearch = (emailSubject + ' ' + emailBody).toLowerCase();
      if (textToSearch.includes('1120s') || textToSearch.includes('corporate') || textToSearch.includes('s-corp') || textToSearch.includes('s corp')) {
        taxType = '1120S';
      } else if (textToSearch.includes('1065') || textToSearch.includes('partnership') || textToSearch.includes('partner')) {
        taxType = '1065';
      } else if (textToSearch.includes('1120') || textToSearch.includes('c-corp') || textToSearch.includes('c corp')) {
        taxType = '1120';
      }

      // Auto-create Client profile
      client = await prisma.client.create({
        data: {
          userId: user.id,
          companyName: 'Individual Taxpayer',
          taxType,
          taxYear: new Date().getFullYear() - 1,
          status: 'ONBOARDING'
        }
      });
    }

    // 2. Process attachments and perform AI classification
    const createdDocuments = [];
    const createdDocumentsInfoForBg = [];

    console.log(`[Incoming Email API] Request received from ${fromEmail} (Subject: "${subject}")`);
    
    // Support standard attachments, inline attachments, and potential arrays sent by n8n or mail parsers
    const rawAttachments = [
      ...(attachments || []),
      ...(body.attachments || []),
      ...(body.inlineAttachments || []),
      ...(body.attachment ? (Array.isArray(body.attachment) ? body.attachment : [body.attachment]) : []),
      ...(body.files || []),
      ...(body.file ? (Array.isArray(body.file) ? body.file : [body.file]) : [])
    ];

    // Deduplicate attachments list by object identity/reference or specific properties
    const seen = new Set();
    const attachmentsList = [];
    for (const attach of rawAttachments) {
      if (!attach) continue;
      const key = attach.name || attach.filename || attach.fileName || attach.url || attach.data || attach.base64Data || Math.random().toString();
      if (!seen.has(key)) {
        seen.add(key);
        attachmentsList.push(attach);
      }
    }

    console.log(`[Incoming Email API] Processing ${attachmentsList.length} attachments.`);

    for (const attach of attachmentsList) {
      if (!attach) continue;

      // Support alternate property names (n8n commonly maps to filename, contentType, size, etc.)
      const rawName = attach.name || attach.filename || attach.fileName || '';
      const url = attach.url || '';
      const fileSize = attach.fileSize ?? attach.size ?? 1024;
      const fileType = attach.fileType || attach.mimeType || attach.contentType || '';
      const data = attach.data || attach.base64Data || attach.fileData || attach.content;

      // Safe parsing of fileSize to integer
      let parsedSize = 1024;
      if (typeof fileSize === 'number') {
        parsedSize = Math.round(fileSize);
      } else if (typeof fileSize === 'string') {
        const cleanSize = fileSize.replace(/[^0-9.]/g, '');
        const num = parseFloat(cleanSize);
        if (!isNaN(num)) {
          const lower = fileSize.toLowerCase();
          if (lower.includes('kb') || lower.includes('k')) {
            parsedSize = Math.round(num * 1024);
          } else if (lower.includes('mb') || lower.includes('m')) {
            parsedSize = Math.round(num * 1024 * 1024);
          } else {
            parsedSize = Math.round(num);
          }
        }
      }

      // Deduce extension from MIME type / contentType if name has no extension
      let deducedExt = '';
      if (fileType) {
        const typeLower = fileType.toLowerCase();
        if (typeLower.includes('pdf')) deducedExt = 'pdf';
        else if (typeLower.includes('png')) deducedExt = 'png';
        else if (typeLower.includes('jpeg') || typeLower.includes('jpg')) deducedExt = 'jpeg';
        else if (typeLower.includes('webp')) deducedExt = 'webp';
        else if (typeLower.includes('gif')) deducedExt = 'gif';
        else if (typeLower.includes('heic')) deducedExt = 'heic';
        else if (typeLower.includes('word') || typeLower.includes('officedocument.wordprocessingml')) deducedExt = 'docx';
        else if (typeLower.includes('text') || typeLower.includes('plain')) deducedExt = 'txt';
      }

      let name = rawName.trim();
      if (!name) {
        name = deducedExt ? `attachment.${deducedExt}` : 'attachment.pdf';
      } else if (!name.includes('.') && deducedExt) {
        name = `${name}.${deducedExt}`;
      }

      // Fast initial regex classification
      const fallbackResult = fallbackClassifier(name);

      // Save attachment binary (direct base64 from n8n or fetch from URL)
      let fileDataBase64: string | null = data || null;
      if (!fileDataBase64 && url && url.startsWith('http')) {
        try {
          console.log(`Downloading attachment binary from: ${url}`);
          const fileRes = await fetch(url);
          if (fileRes.ok) {
            const arrayBuffer = await fileRes.arrayBuffer();
            fileDataBase64 = Buffer.from(arrayBuffer).toString('base64');
          } else {
            console.warn(`Failed to fetch attachment binary. Status: ${fileRes.status}`);
          }
        } catch (fetchErr) {
          console.error("Error downloading attachment binary:", fetchErr);
        }
      }

      let convertedName = name;
      let convertedSize = parsedSize;
      let convertedFileType = fileType || 'PDF';
      let finalBase64 = fileDataBase64;

      const attachmentExtension = name.split('.').pop()?.toLowerCase() || '';
      const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(attachmentExtension) ||
                      /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name || '');

      if (isImage) {
        convertedFileType = attachmentExtension.toUpperCase();
      }

      // Create document immediately in OCR_PROCESSING status
      const doc = await prisma.document.create({
        data: {
          clientId: client.id,
          name: convertedName,
          url: url || '#',
          fileSize: convertedSize,
          fileType: convertedFileType,
          taxYear: client.taxYear,
          category: fallbackResult.category,
          status: 'OCR_PROCESSING',
          extractedText: null,
          aiSummary: 'Processing document...',
          confidenceScore: fallbackResult.confidenceScore,
          validationErrors: null,
          fileData: finalBase64
        }
      });

      createdDocuments.push(doc);
      createdDocumentsInfoForBg.push({
        id: doc.id,
        name: convertedName,
        attachmentExtension,
        finalBase64,
        clientId: client.id
      });
    }

    // Trigger background processing sequentially
    if (createdDocumentsInfoForBg.length > 0) {
      console.log(`[Email Route] Queued ${createdDocumentsInfoForBg.length} documents for sequential background processing...`);
      (async () => {
        for (const docInfo of createdDocumentsInfoForBg) {
          try {
            console.log(`[Email Background Worker] Processing document: ${docInfo.name} (${docInfo.id})`);
            
            let extractedText = '';
            const finalBase64 = docInfo.finalBase64;
            const attachmentExtension = docInfo.attachmentExtension;
            const name = docInfo.name;

            const fileExt = attachmentExtension || '';
            const isPdf = fileExt === 'pdf' || name?.toLowerCase().endsWith('.pdf');
            const isDocx = ['docx', 'doc'].includes(fileExt) || name?.toLowerCase().endsWith('.docx') || name?.toLowerCase().endsWith('.doc');
            const isTxt = fileExt === 'txt' || name?.toLowerCase().endsWith('.txt');
            const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(fileExt) ||
                            /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name || '');

            if (finalBase64) {

              if (isTxt) {
                try {
                  const fileBuffer = Buffer.from(finalBase64, 'base64');
                  extractedText = fileBuffer.toString('utf-8');
                } catch (txtErr: any) {
                  console.error("TXT parse failed:", txtErr);
                }
              } else if (isDocx) {
                try {
                  const fileBuffer = Buffer.from(finalBase64, 'base64');
                  const mammoth = require('mammoth');
                  const result = await mammoth.extractRawText({ buffer: fileBuffer });
                  extractedText = result.value || '';
                } catch (docxErr: any) {
                  console.error("DOCX parse failed:", docxErr);
                }
              } else if (isPdf) {
                const fileBuffer = Buffer.from(finalBase64, 'base64');
                try {
                  if (typeof (global as any).DOMMatrix === 'undefined') {
                    (global as any).DOMMatrix = class {};
                  }
                  const pdfParseModule = require('pdf-parse');
                  const PDFParseClass = pdfParseModule.PDFParse;
                  
                  if (PDFParseClass) {
                    const parser = new PDFParseClass(new Uint8Array(fileBuffer));
                    const result = await parser.getText();
                    extractedText = result.text || '';
                  } else {
                    const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
                    const pdfData = await pdfParse(fileBuffer);
                    extractedText = pdfData.text || '';
                  }
                } catch (pdfErr: any) {
                  console.error("PDF parse failed:", pdfErr);
                }

                // If PDF text layer is nearly empty, it's a scanned PDF — fall back to Vision OCR
                const cleanPdfText = extractedText.replace(/[\s\-\d]/g, '');
                if (cleanPdfText.length < 50 && process.env.OPENAI_API_KEY) {
                  console.log(`[Email Background Worker] Scanned PDF detected for ${name} — using OpenAI Files API for high-fidelity OCR...`);
                  try {
                    const { performVisionOcrWithFilesApi } = await import('@/lib/openai-pdf-ocr');
                    const visionText = await performVisionOcrWithFilesApi(fileBuffer, name || 'email_attachment.pdf');
                    
                    if (visionText && visionText.trim().length > 50) {
                      extractedText = visionText;
                      console.log(`[Email Background Worker] OpenAI Files API vision OCR succeeded for ${name}. Text length:`, visionText.length);
                    } else {
                      console.warn(`[Email Background Worker] OpenAI Files API vision OCR returned minimal text for ${name}.`);
                    }
                  } catch (visionFallbackErr: any) {
                    console.error(`[Email Background Worker] OpenAI Files API vision OCR failed for ${name}:`, visionFallbackErr?.message);
                  }
                }
              } else if (isImage && process.env.OPENAI_API_KEY) {
                try {
                  let openAiMimeType = 'image/png';
                  const extLower = fileExt.toLowerCase();
                  if (extLower === 'jpg' || extLower === 'jpeg') {
                    openAiMimeType = 'image/jpeg';
                  } else if (extLower === 'webp') {
                    openAiMimeType = 'image/webp';
                  } else if (extLower === 'gif') {
                    openAiMimeType = 'image/gif';
                  } else if (extLower === 'heic' || extLower === 'heif') {
                    openAiMimeType = 'image/heic';
                  }

                  const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                      {
                        role: 'user',
                        content: [
                          { type: 'text', text: 'Transcribe all visible text from this document image. Focus on capturing numbers, labels, forms fields, employer names, wages, and social security benefit values precisely.' },
                          {
                            type: 'image_url',
                            image_url: {
                              url: `data:${openAiMimeType};base64,${finalBase64}`
                            }
                          }
                        ]
                      }
                    ]
                  });
                  extractedText = response.choices[0].message?.content || '';
                } catch (visionErr) {
                  console.error(`[Email Background Worker] OpenAI vision parse failed for email attachment ${name}:`, visionErr);
                }
              }
            }

            extractedText = extractedText.trim();

            // Run classifyDocumentWithAI using OpenAI
            const aiResult = await classifyDocumentWithAI(name, emailSubject, emailBody);
            let category = aiResult.category;
            let aiSummary = aiResult.aiSummary;
            let confidenceScore = aiResult.confidenceScore;
            let validationErrors = aiResult.validationErrors;

            // Check for OMB fingerprint override
            const cleanTextForOMB = extractedText.replace(/[\s\-\_\,\.\/\(\)\*]/g, '').toLowerCase();
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
              console.log(`[Email Background Worker] OMB fingerprint matched: ${detectedCategory}. Overriding category.`);
              category = detectedCategory;
            }

            // Confirm/refine category using direct vision classification for images, or fallback for text docs
            let detectedTaxYear = client.taxYear;
            const hasOpenAI = process.env.OPENAI_API_KEY && 
                              process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                              process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

            if (hasOpenAI && isImage && finalBase64) {
              try {
                console.log(`[Email Background Worker] Running direct vision classification for uploaded image...`);
                const response = await openai.chat.completions.create({
                  model: 'gpt-4o',
                  messages: [{
                    role: 'user',
                    content: [
                      { type: 'text', text: DIRECT_VISION_CLASSIFIER_PROMPT },
                      {
                        type: 'image_url',
                        image_url: {
                          url: `data:image/${attachmentExtension || 'png'};base64,${finalBase64}`
                        }
                      }
                    ]
                  }],
                  response_format: { type: "json_object" }
                });

                const result = JSON.parse(response.choices[0].message?.content || '{}');
                category = result.category || category;
                confidenceScore = result.confidenceScore || confidenceScore;
                aiSummary = result.aiSummary || aiSummary;
                validationErrors = result.validationErrors || null;
                
                let parsedYear = result.taxYear ? Number(result.taxYear) : null;
                if (parsedYear && !isNaN(parsedYear)) {
                  detectedTaxYear = parsedYear;
                } else {
                  detectedTaxYear = extractTaxYear(extractedText, client.taxYear);
                }
              } catch (visionClassErr) {
                console.error(`[Email Background Worker] Direct vision classification failed for image ${name}:`, visionClassErr);
                detectedTaxYear = extractTaxYear(extractedText, client.taxYear);
              }
            } else {
              // Commented out text classifier for PDF/Doc attachments - direct vision classification runs on the rendered companion PNG instead.
              /*
              if (extractedText && (category === 'UNCLASSIFIED' || category.startsWith('1099') || category === 'W2' || category === '1098' || category === '1095-A')) {
                try {
                  console.log(`[Email Background Worker] Confirming/refining category (${category}) based on OCR text...`);
                  const currentYear = new Date().getFullYear();
                  const previousYear = currentYear - 1;
                  const prompt = `You are an expert CPA Tax Assistant.
  Analyze the following raw OCR text extracted from an uploaded client document:
  ---
  ${extractedText}
  ---

  Your task:
  1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
  2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
  3. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than ${previousYear} or ${currentYear}, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
  4. Estimate your parsing confidence score between 0.0 and 1.0.
  5. If the document is any form of 1099 (e.g. 1099-R, 1099-G, 1099-B, 1099-K, etc.), always categorize it under its specific 1099 category if listed, or use "1099-UNCLASSIFIED" if it is not one of the specific ones. Never classify a 1099 form as "UNCLASSIFIED".
  6. Extract the document's tax year (e.g., 2025, 2024, etc.). If you cannot determine the tax year from the text, return ${client.taxYear}.

  Format your output as a JSON object with keys:
  "category", "aiSummary", "confidenceScore", "validationErrors", "taxYear"`;

                  const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: "json_object" }
                  });

                  const result = JSON.parse(response.choices[0].message?.content || '{}');
                  if (result.category && result.category !== 'UNCLASSIFIED') {
                    category = result.category;
                    aiSummary = result.aiSummary || aiSummary;
                    confidenceScore = result.confidenceScore || confidenceScore;
                    validationErrors = result.validationErrors;
                  }

                  // Extract and validate taxYear
                  let parsedYear = result.taxYear ? Number(result.taxYear) : null;
                  if (parsedYear && !isNaN(parsedYear)) {
                    detectedTaxYear = parsedYear;
                  } else {
                    detectedTaxYear = extractTaxYear(extractedText, client.taxYear);
                  }
                } catch (reclassErr) {
                  console.error(`[Email Background Worker] Re-classification failed for ${name}:`, reclassErr);
                  detectedTaxYear = extractTaxYear(extractedText, client.taxYear);
                }
              } else if (extractedText) {
                detectedTaxYear = extractTaxYear(extractedText, client.taxYear);
              }
              */
              detectedTaxYear = extractTaxYear(extractedText, client.taxYear);
            }

            if (isPdf && finalBase64) {
              try {
                console.log(`[Email Background Worker] Converting PDF attachment ${name} to PNG for manual verification...`);
                const { convertPdfToImages } = await import('@/lib/pdf-converter');
                const fileBuffer = Buffer.from(finalBase64, 'base64');
                const pagesBase64 = await convertPdfToImages(fileBuffer, 4, category);

                if (pagesBase64.length > 0) {
                  const imageBase64 = pagesBase64[0];
                  const imageName = `${name.replace(/\.pdf$/i, '')} (Image Verification).png`;

                  let pngText = '';
                  let pngCategory = category;
                  let pngAiSummary = aiSummary;
                  let pngConfidenceScore = confidenceScore;
                  let pngValidationErrors = validationErrors;

                  // 1. Run high-fidelity Vision OCR on the companion image
                  if (process.env.OPENAI_API_KEY) {
                    try {
                      console.log(`[Email Background Worker] Running high-fidelity Vision OCR on converted PNG...`);
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
                                url: `data:image/png;base64,${imageBase64}`
                      }
                    }
                  ]
                }],
                max_tokens: 4000
              });

                      pngText = visionResponse.choices[0].message?.content || '';
                    } catch (visionErr) {
                      console.error("[Email Background Worker] Vision OCR on PNG failed, falling back to PDF extracted text:", visionErr);
                      pngText = extractedText || '';
                    }
                  }

                  // 2. Classify PNG text using OpenAI
                  // 2. Classify PNG using direct vision model
                  if (process.env.OPENAI_API_KEY) {
                    try {
                      console.log(`[Email Background Worker] Running direct vision classification on companion PNG...`);
                      const visionResponse = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [{
                          role: 'user',
                          content: [
                            { type: 'text', text: DIRECT_VISION_CLASSIFIER_PROMPT },
                            {
                              type: 'image_url',
                              image_url: {
                                url: `data:image/png;base64,${imageBase64}`
                              }
                            }
                          ]
                        }],
                        response_format: { type: "json_object" }
                      });

                      const result = JSON.parse(visionResponse.choices[0].message?.content || '{}');
                      pngCategory = result.category || pngCategory;
                      pngAiSummary = result.aiSummary || pngAiSummary;
                      pngConfidenceScore = result.confidenceScore || pngConfidenceScore;
                      pngValidationErrors = result.validationErrors || null;
                      
                      let parsedYear = result.taxYear ? Number(result.taxYear) : null;
                      if (parsedYear && !isNaN(parsedYear)) {
                        detectedTaxYear = parsedYear;
                      } else {
                        detectedTaxYear = extractTaxYear(pngText || extractedText, client.taxYear);
                      }
                    } catch (visionClassErr) {
                      console.error("[Email Background Worker] Direct vision classification on companion PNG failed:", visionClassErr);
                    }
                  }

                  /* COMMENTED OUT ORIGINAL TEXT-BASED CLASSIFICATION FOR COMPANION PNG
                  if (pngText && process.env.OPENAI_API_KEY) {
                    try {
                      const currentYear = new Date().getFullYear();
                      const previousYear = currentYear - 1;
                      const prompt = `You are an expert CPA Tax Assistant.
  Analyze the following raw OCR text extracted from an uploaded client document:
  ---
  ${pngText}
  ---

  Your task:
  1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
  2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
  3. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than ${previousYear} or ${currentYear}, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
  4. Estimate your parsing confidence score between 0.0 and 1.0.
  5. If the document is any form of 1099 (e.g. 1099-R, 1099-G, 1099-B, 1099-K, etc.), always categorize it under its specific 1099 category if listed, or use "1099-UNCLASSIFIED" if it is not one of the specific ones. Never classify a 1099 form as "UNCLASSIFIED".
  6. Extract the document's tax year (e.g., 2025, 2024, etc.). If you cannot determine the tax year from the text, return ${client.taxYear}.

  Format your output as a JSON object with keys:
  "category", "aiSummary", "confidenceScore", "validationErrors", "taxYear"`;

                      const response = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: "json_object" }
                      });

                      const result = JSON.parse(response.choices[0].message?.content || '{}');
                      pngCategory = result.category || pngCategory;
                      pngAiSummary = result.aiSummary || pngAiSummary;
                      pngConfidenceScore = result.confidenceScore || pngConfidenceScore;
                      pngValidationErrors = result.validationErrors || null;

                      // Extract and validate taxYear
                      let parsedYear = result.taxYear ? Number(result.taxYear) : null;
                      if (parsedYear && !isNaN(parsedYear)) {
                        detectedTaxYear = parsedYear;
                      } else {
                        detectedTaxYear = extractTaxYear(pngText, client.taxYear);
                      }
                    } catch (openaiErr) {
                      console.error("[Email Background Worker] OpenAI processing of PNG text failed:", openaiErr);
                    }
                  } else if (pngText) {
                    detectedTaxYear = extractTaxYear(pngText, client.taxYear);
                  }
                  */

                  // 3. Check for OMB fingerprint override on PNG text
                  if (pngText) {
                    const cleanTextForOMB = pngText.replace(/[\s\-\_\,\.\/\(\)\*]/g, '').toLowerCase();
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
                      console.log(`[Email Background Worker] OMB fingerprint matched on PNG: ${detectedCategory}. Overriding category.`);
                      pngCategory = detectedCategory;
                    }
                  }

                  // 4. Save PNG Document in DB
                  const pngStatus = (pngValidationErrors || pngCategory === 'UNCLASSIFIED' || pngCategory === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED';
                  const pngDocument = await prisma.document.create({
                    data: {
                      clientId: docInfo.clientId,
                      name: imageName,
                      url: '#',
                      fileSize: Math.round(imageBase64.length * 0.75),
                      fileType: 'PNG',
                      taxYear: detectedTaxYear,
                      category: pngCategory,
                      status: pngStatus,
                      extractedText: pngText || null,
                      aiSummary: pngAiSummary,
                      confidenceScore: pngConfidenceScore,
                      validationErrors: pngValidationErrors,
                      fileData: imageBase64
                    }
                  });

                  // 5. Generate RAG chunks for PNG Document (DISABLED AS REQUESTED)
                  if (pngText) {
                    /*
                    try {
                      await processDocumentChunks(pngDocument.id, pngText);
                    } catch (chunkErr) {
                      console.error("Failed to generate document chunks for PNG:", chunkErr);
                    }
                    */

                    // Extract tax form fields if category matches
                    if (pngDocument.category === 'W2' || pngDocument.category.startsWith('1099') || pngDocument.category.includes('1099') || pngDocument.category === '1095-A' || pngDocument.category === '1098') {
                      try {
                        await extractAndSaveTaxFormData(pngDocument.id, pngDocument.category, pngText);
                      } catch (tfErr) {
                        console.error("Failed to extract tax form data for PNG:", tfErr);
                      }
                    }
                  }

                  // 6. Update original PDF document in database (retaining it)
                  const finalStatus = (validationErrors || category === 'UNCLASSIFIED' || category === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED';
                  await prisma.document.update({
                    where: { id: docInfo.id },
                    data: {
                      category,
                      status: finalStatus,
                      extractedText: extractedText || null,
                      aiSummary,
                      confidenceScore,
                      validationErrors,
                      taxYear: detectedTaxYear
                    }
                  });

                  console.log(`[Email Background Worker] Updated PDF document ${docInfo.id} with final details.`);
                } else {
                  throw new Error("No pages rendered from PDF");
                }
              } catch (pdfToPngErr) {
                console.error("[Email Background Worker] PDF to PNG workflow failed, falling back to updating PDF document:", pdfToPngErr);
                // Fallback: update original PDF document in DB
                const finalStatus = (validationErrors || category === 'UNCLASSIFIED' || category === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED';
                await prisma.document.update({
                  where: { id: docInfo.id },
                  data: {
                    category,
                    status: finalStatus,
                    extractedText: extractedText || null,
                    aiSummary,
                    confidenceScore,
                    validationErrors,
                    taxYear: detectedTaxYear
                  }
                });

              }
            } else {
              // Non-PDF flow (same as original)
              const finalStatus = (validationErrors || category === 'UNCLASSIFIED' || category === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED';
              await prisma.document.update({
                where: { id: docInfo.id },
                data: {
                  category,
                  status: finalStatus,
                  extractedText: extractedText || null,
                  aiSummary,
                  confidenceScore,
                  validationErrors,
                  taxYear: detectedTaxYear
                }
              });

              if (extractedText) {
                /* RAG CHUNKS DISABLED AS REQUESTED
                try {
                  await processDocumentChunks(docInfo.id, extractedText);
                } catch (chunkErr) {
                  console.error(`[Email Background Worker] Failed to generate document chunks for ${name}:`, chunkErr);
                }
                */

                if (category === 'W2' || category.startsWith('1099') || category.includes('1099') || category === '1095-A' || category === '1098') {
                  try {
                    await extractAndSaveTaxFormData(docInfo.id, category, extractedText);
                  } catch (tfErr) {
                    console.error(`[Email Background Worker] Failed to extract tax form data for ${name}:`, tfErr);
                  }
                }
              }
            }

            // Finally, update Client status based on the new audit state
            const allDocsForClient = await prisma.document.findMany({
              where: { clientId: docInfo.clientId }
            });
            const clientAudit = auditClientDocuments(client.taxType, allDocsForClient);
            let nextStatus = client.status;
            if (clientAudit.isComplete) {
              if (client.status === 'ONBOARDING' || client.status === 'MISSING_DOCS') {
                nextStatus = 'IN_PREPARATION';
              }
            } else {
              if (client.status === 'ONBOARDING' || client.status === 'IN_PREPARATION') {
                nextStatus = 'MISSING_DOCS';
              }
            }
            if (nextStatus !== client.status) {
              await prisma.client.update({
                where: { id: docInfo.clientId },
                data: { status: nextStatus }
              });
              client.status = nextStatus; // Keep local representation updated
            }

            console.log(`[Email Background Worker] Successfully finished processing document: ${name} (${docInfo.id})`);

          } catch (docErr: any) {
            console.error(`[Email Background Worker] Failed to process document ${docInfo.id}:`, docErr);
            try {
              await prisma.document.update({
                where: { id: docInfo.id },
                data: {
                  status: 'REVIEW_REQUIRED',
                  validationErrors: `Background processing failed: ${docErr.message || docErr}`
                }
              });
            } catch (dbErr) {
              console.error(`[Email Background Worker] Could not save processing failure error for ${docInfo.id}:`, dbErr);
            }
          }
        }
        console.log(`[Email Background Worker] All ${createdDocumentsInfoForBg.length} attachments completed processing.`);
      })();
    }

    // 3. Get all client documents to audit completeness
    const allDocs = await prisma.document.findMany({
      where: { clientId: client.id }
    });

    const audit = auditClientDocuments(client.taxType, allDocs);

    // 4. Update Client status based on audit results
    let updatedStatus = client.status;
    if (audit.isComplete) {
      // If complete, move to IN_PREPARATION (if currently ONBOARDING or MISSING_DOCS)
      if (client.status === 'ONBOARDING' || client.status === 'MISSING_DOCS') {
        updatedStatus = 'IN_PREPARATION';
      }
    } else {
      // If incomplete, move to MISSING_DOCS (if currently ONBOARDING or IN_PREPARATION)
      if (client.status === 'ONBOARDING' || client.status === 'IN_PREPARATION') {
        updatedStatus = 'MISSING_DOCS';
      }
    }

    if (updatedStatus !== client.status) {
      client = await prisma.client.update({
        where: { id: client.id },
        data: { status: updatedStatus }
      });
    }

    return NextResponse.json({
      success: true,
      clientId: client.id,
      clientName: user.name,
      fromEmail: user.email,
      taxType: client.taxType,
      clientStatus: client.status,
      isComplete: audit.isComplete,
      missingRequirements: audit.missingRequirements,
      onboardedNewUser,
      newDocuments: createdDocuments
    });

  } catch (error: any) {
    console.error('Incoming Email Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}



async function convertImageToPdfServer(buffer: Buffer, filename: string): Promise<{ pdfBuffer: Buffer, pdfName: string }> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();

  const extension = filename.split('.').pop()?.toLowerCase();
  let img;
  if (extension === 'png') {
    img = await pdfDoc.embedPng(buffer);
  } else {
    img = await pdfDoc.embedJpg(buffer);
  }

  // Scale the image to fit the page margin (20px padding)
  const imgDims = img.scaleToFit(width - 40, height - 40);
  
  // Center
  page.drawImage(img, {
    x: (width - imgDims.width) / 2,
    y: (height - imgDims.height) / 2,
    width: imgDims.width,
    height: imgDims.height,
  });

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  
  const baseName = filename.substring(0, filename.lastIndexOf('.'));
  const pdfName = `${baseName}.pdf`;

  return { pdfBuffer, pdfName };
}
