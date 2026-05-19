import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { auditClientDocuments } from '@/lib/taxRules';

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

Classify it into one of these exact categories: "W2", "1099-NEC", "1099", "Bank_Statement", "Receipt", "Tax_Notice", "Ledger", "Balance_Sheet", "UNCLASSIFIED".

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
  } else if (nameLower.includes('1099')) {
    category = '1099-NEC';
    aiSummary = '1099 Nonemployee Compensation statement.';
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

    const emailSubject = subject || '';
    const emailBody = bodyText || '';

    // 1. Find or auto-provision User and Client
    let user = await prisma.user.findUnique({
      where: { email: fromEmail }
    });

    let onboardedNewUser = false;

    if (!user) {
      // Auto-create User profile
      user = await prisma.user.create({
        data: {
          email: fromEmail,
          name: fromName || fromEmail.split('@')[0],
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
    const attachmentsList = attachments || [];

    for (const attach of attachmentsList) {
      const { name, url, fileSize, fileType } = attach;

      // Classify the document category using OpenAI
      const aiResult = await classifyDocumentWithAI(name, emailSubject, emailBody);

      const doc = await prisma.document.create({
        data: {
          clientId: client.id,
          name,
          url: url || '#',
          fileSize: fileSize || 1024,
          fileType: fileType || 'PDF',
          taxYear: 2026,
          category: aiResult.category,
          status: aiResult.validationErrors ? 'REVIEW_REQUIRED' : 'VALIDATED',
          extractedText: `Simulated OCR text content for attachment: ${name}.`,
          aiSummary: aiResult.aiSummary,
          confidenceScore: aiResult.confidenceScore,
          validationErrors: aiResult.validationErrors
        }
      });

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
