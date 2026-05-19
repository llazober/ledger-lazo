import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { auditClientDocuments } from '@/lib/taxRules';
import { PDFDocument } from 'pdf-lib';

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
      const { name, url, fileSize, fileType, data } = attach;

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
      const isImage = ['png', 'jpg', 'jpeg'].includes(attachmentExtension);

      if (isImage && finalBase64) {
        try {
          const imgBuffer = Buffer.from(finalBase64, 'base64');
          const { pdfBuffer, pdfName } = await convertImageToPdfServer(imgBuffer, name);
          convertedName = pdfName;
          convertedSize = pdfBuffer.length;
          convertedFileType = 'PDF';
          finalBase64 = pdfBuffer.toString('base64');
        } catch (err) {
          console.error("Error converting image attachment to PDF on server:", err);
        }
      }

      let status = aiResult.validationErrors ? 'REVIEW_REQUIRED' : 'VALIDATED';
      let validationErrors = aiResult.validationErrors;

      if (convertedFileType.toUpperCase() !== 'PDF') {
        status = 'REVIEW_REQUIRED';
        validationErrors = `Unsupported file format (${convertedFileType}). The vault requires documents to be in PDF format. Please convert this file to PDF.`;
      }

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
          extractedText: generateRealisticMockOCRText(convertedName, aiResult.category),
          aiSummary: aiResult.aiSummary,
          confidenceScore: aiResult.confidenceScore,
          validationErrors,
          fileData: finalBase64
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

function generateRealisticMockOCRText(filename: string, category: string): string {
  const nameLower = filename.toLowerCase();
  
  if (category === 'W2') {
    return `Form W-2 Wage and Tax Statement 2025
--------------------------------------------------
Employer Identification Number (EIN): 12-3456789
Employer Name: Datalazo Technologies Inc.
Employee Name: Luis Lazo
Social Security Number: XXX-XX-9876

Box 1 (Wages, tips, other comp.): $95,000.00
Box 2 (Federal income tax withheld): $14,250.00
Box 3 (Social security wages): $95,000.00
Box 4 (Social security tax withheld): $5,890.00
Box 5 (Medicare wages and tips): $95,000.00
Box 6 (Medicare tax withheld): $1,377.50
Box 15 (State): FL / State EIN: N/A
Box 16 (State wages): $95,000.00
Box 17 (State income tax): $0.00
--------------------------------------------------
Status: Validated for filing.`;
  }
  
  if (category === '1099-INT') {
    return `Form 1099-INT Interest Income 2025
--------------------------------------------------
Payer Name: Chase Bank N.A.
Recipient Name: Luis Lazo

Box 1 (Interest income): $1,450.00
Box 3 (Interest on U.S. Savings Bonds): $0.00
Box 4 (Federal income tax withheld): $0.00
--------------------------------------------------
Status: Validated. Categorized as taxable interest income.`;
  }

  if (category === '1099-DIV') {
    return `Form 1099-DIV Dividends and Distributions 2025
--------------------------------------------------
Payer Name: Vanguard Group Inc.
Recipient Name: Luis Lazo

Box 1a (Total ordinary dividends): $2,800.00
Box 1b (Qualified dividends): $2,100.00
Box 2a (Total capital gain distr.): $450.00
Box 4 (Federal income tax withheld): $0.00
--------------------------------------------------
Status: Validated. Dividends mapped to Schedule B.`;
  }

  if (category === '1099-R') {
    return `Form 1099-R Distributions From Pensions, Annuities, etc. 2025
--------------------------------------------------
Payer Name: Fidelity Investments
Recipient Name: Luis Lazo

Box 1 (Gross distribution): $15,000.00
Box 2a (Taxable amount): $15,000.00
Box 4 (Federal income tax withheld): $1,500.00
Box 7 (Distribution code): 7 (Normal distribution)
--------------------------------------------------
Status: Validated. IRA/401k distribution registered.`;
  }

  if (category === '1099-MISC') {
    return `Form 1099-MISC Miscellaneous Information 2025
--------------------------------------------------
Payer Name: Real Estate Mgmt LLC
Recipient Name: Luis Lazo

Box 1 (Rents): $18,000.00
Box 3 (Other income): $0.00
Box 4 (Federal income tax withheld): $0.00
--------------------------------------------------
Status: Validated. Rental income mapped to Schedule E.`;
  }

  if (category === '1099-B') {
    return `Form 1099-B Proceeds From Brokerage Transactions 2025
--------------------------------------------------
Payer Name: Charles Schwab & Co.
Recipient Name: Luis Lazo

Box 1d (Proceeds from transactions): $45,800.00
Box 1e (Cost or other basis): $38,200.00
Box 1g (Wash sale loss disallowed): $0.00
Net Realized Gain/Loss: +$7,600.00 (Short-term)
--------------------------------------------------
Status: Validated. Mapped to Schedule D (Capital Gains).`;
  }

  if (category === 'SSA-1099') {
    return `Form SSA-1099 - SOCIAL SECURITY BENEFIT STATEMENT 2025
--------------------------------------------------
Payer: Social Security Administration
Recipient Name: Luis Lazo
Social Security Number: XXX-XX-9876

Box 3 (Benefits paid in 2025): $24,600.00
Box 4 (Federal income tax withheld): $0.00
Net Benefits Paid: $24,600.00
--------------------------------------------------
Status: Validated. Social Security Income processed.`;
  }

  if (category === '1099-NEC' || category === '1099') {
    return `Form 1099-NEC Nonemployee Compensation 2025
--------------------------------------------------
Payer Name: Stripe Inc.
Payer TIN: 98-7654321
Recipient Name: Luis Lazo
Recipient TIN: XXX-XX-9876

Box 1 (Nonemployee compensation): $12,500.00
Box 4 (Federal income tax withheld): $0.00
Box 5 (State tax withheld): $0.00
--------------------------------------------------
Category: 1099-NEC Independent Contractor Revenue.`;
  }
  
  if (category === 'Bank_Statement') {
    return `CHASE BUSINESS CHECKING STATEMENT
Account Number: *******8921
Period: Dec 01, 2025 - Dec 31, 2025

Starting Balance: $28,450.00
Total Deposits: $14,800.00
Total Withdrawals: $18,120.00
Ending Balance: $25,130.00

TRANSACTION DETAILS:
--------------------------------------------------
Dec 03 | deposit  | Stripe Transfer        | +$4,200.00
Dec 08 | withdraw | AWS Cloud Services     | -$1,250.00
Dec 12 | withdraw | Landlord Rent LLC      | -$3,500.00
Dec 15 | withdraw | IRS Tax Payment        | -$2,500.00
Dec 22 | withdraw | Transfer to Savings    | -$5,000.00 (Flagged)
Dec 28 | deposit  | Client ACH Payment     | +$10,600.00
--------------------------------------------------
Ending Balance Confirmed: $25,130.00`;
  }
  
  if (category === 'Receipt') {
    return `RECEIPT / INVOICE
--------------------------------------------------
Merchant: Apple Store Lincoln Rd
Location: Miami, FL 33139
Date: 2025-11-20 14:22:10

ITEMS PURCHASED:
1x MacBook Pro 14-inch M3     | $1,999.00
1x AppleCare+ Protection Plan  | $279.00

Subtotal: $2,278.00
Sales Tax (7.0%): $159.46
Total: $2,437.46

Payment Method: Visa ending in 4321
--------------------------------------------------
Status: Paid. Business Asset Equipment.`;
  }

  if (category === 'Balance_Sheet') {
    return `BALANCE SHEET STATEMENT
As of December 31, 2025

ASSETS:
Cash & Cash Equivalents: $25,130.00
Accounts Receivable: $8,400.00
Equipment & Hardware: $4,500.00
Total Assets: $38,030.00

LIABILITIES & EQUITY:
Accounts Payable: $1,200.00
Short-Term Business Loan: $5,000.00
Shareholder Capital Investment: $20,000.00
Retained Earnings: $11,830.00
Total Liabilities & Equity: $38,030.00`;
  }

  if (category === 'Tax_Notice') {
    return `DEPARTMENT OF THE TREASURY
INTERNAL REVENUE SERVICE
CINCINNATI, OH 45999-0010

Date of Notice: Nov 15, 2025
Taxpayer ID: XX-XXX9876
Form: 1120S
Tax Period: Dec 31, 2024

NOTICE OF UNPAID BALANCE - TAX YEAR 2024
Our records show you have outstanding balance for the tax period above.
Total Amount Due: $4,500.00
Penalty & Interest Calculated: $320.00
Please send payment by Dec 15, 2025 to avoid further accumulation.`;
  }

  return "No text could be extracted from this document.";
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
