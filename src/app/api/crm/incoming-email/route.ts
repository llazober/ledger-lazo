import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { auditClientDocuments } from '@/lib/taxRules';
import { PDFDocument } from 'pdf-lib';
import { processDocumentChunks } from '@/lib/ai-processor';

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

Classify it into one of these exact categories: "W2", "1099-NEC", "1099", "1099-INT", "1099-DIV", "1099-R", "1099-MISC", "1099-B", "SSA-1099", "Bank_Statement", "Receipt", "Tax_Notice", "Ledger", "Balance_Sheet", "UNCLASSIFIED".

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
  const nameLower = filename.toLowerCase();
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
          taxYear: 2026,
          status: 'ONBOARDING'
        }
      });
    }

    // 2. Process attachments and perform AI classification
    const createdDocuments = [];
    const attachmentsList = attachments || body.attachment || body.files || body.file || [];

    for (const attach of attachmentsList) {
      const { name, url, fileSize, fileType } = attach;
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

      // Classify the document category using OpenAI
      const aiResult = await classifyDocumentWithAI(name, emailSubject, emailBody);

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
      const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(attachmentExtension) ||
                      /\.(png|jpe?g|webp|gif)$/i.test(name || '');

      if (isImage) {
        convertedFileType = attachmentExtension.toUpperCase();
      }

      const status = aiResult.validationErrors ? 'REVIEW_REQUIRED' : 'VALIDATED';
      const validationErrors = aiResult.validationErrors;

      let extractedText = '';
      if (finalBase64) {
        const fileExt = attachmentExtension || '';
        const isPdf = fileExt === 'pdf' || name?.toLowerCase().endsWith('.pdf');
        const isDocx = ['docx', 'doc'].includes(fileExt) || name?.toLowerCase().endsWith('.docx') || name?.toLowerCase().endsWith('.doc');
        const isTxt = fileExt === 'txt' || name?.toLowerCase().endsWith('.txt');

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
          try {
            const fileBuffer = Buffer.from(finalBase64, 'base64');
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
        } else if (isImage && process.env.OPENAI_API_KEY) {
          try {
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
                        url: `data:image/${fileExt || 'png'};base64,${finalBase64}`
                      }
                    }
                  ]
                }
              ]
            });
            extractedText = response.choices[0].message?.content || '';
          } catch (visionErr) {
            console.error("OpenAI vision parse failed for email attachment:", visionErr);
          }
        }
      }

      // Clean up extractedText whitespace
      extractedText = extractedText.trim();

      const doc = await prisma.document.create({
        data: {
          clientId: client.id,
          name: convertedName,
          url: url || '#',
          fileSize: convertedSize,
          fileType: convertedFileType,
          taxYear: 2026,
          category: aiResult.category,
          status,
          extractedText: extractedText || null,
          aiSummary: aiResult.aiSummary,
          confidenceScore: aiResult.confidenceScore,
          validationErrors,
          fileData: finalBase64
        }
      });

      // Generate RAG chunks and embeddings so it is indexed for search
      if (extractedText) {
        try {
          await processDocumentChunks(doc.id, extractedText);
        } catch (chunkErr) {
          console.error("Failed to generate document chunks for email attachment:", chunkErr);
        }
      }

      createdDocuments.push(doc);
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
