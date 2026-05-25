import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import mammoth from 'mammoth';
import { processDocumentChunks, extractAndSaveTaxFormData } from '@/lib/ai-processor';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      name, 
      fileSize, 
      fileType, 
      category: clientCategory, 
      status: clientStatus, 
      extractedText: clientExtractedText, 
      aiSummary: clientAiSummary, 
      confidenceScore: clientConfidenceScore, 
      validationErrors: clientValidationErrors,
      fileData,
      originalImage,
      clientId
    } = body;

    let category = clientCategory || 'UNCLASSIFIED';
    let status = clientStatus || 'UPLOADED';
    let extractedText = clientExtractedText || null;
    let aiSummary = clientAiSummary || null;
    let confidenceScore = clientConfidenceScore || 0.0;
    let validationErrors = clientValidationErrors || null;

    if (fileData) {
      const fileBuffer = Buffer.from(fileData, 'base64');
      let rawText = '';
      
      const fileExt = fileType?.toLowerCase() || '';
      const isPdf = fileExt === 'pdf' || name?.toLowerCase().endsWith('.pdf');
      const isDocx = fileExt === 'docx' || name?.toLowerCase().endsWith('.docx') || name?.toLowerCase().endsWith('.doc');
      const isTxt = fileExt === 'txt' || name?.toLowerCase().endsWith('.txt');
      const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(fileExt) ||
                      /\.(png|jpe?g|webp|gif)$/i.test(name || '');

      if (isTxt) {
        try {
          rawText = fileBuffer.toString('utf-8');
        } catch (txtErr: any) {
          console.error("TXT parse failed:", txtErr);
          rawText = `[Error parsing text file: ${txtErr.message}]`;
        }
      } else if (isDocx) {
        try {
          const result = await mammoth.extractRawText({ buffer: fileBuffer });
          rawText = result.value || '';
        } catch (docxErr: any) {
          console.error("DOCX parse failed:", docxErr);
          rawText = `[Error parsing Word file: ${docxErr.message}]`;
        }
      } else if ((isImage || originalImage) && process.env.OPENAI_API_KEY) {
        try {
          const imgBase64 = originalImage || fileData;
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
                      url: `data:image/${fileExt || 'png'};base64,${imgBase64}`
                    }
                  }
                ]
              }
            ]
          });
          rawText = response.choices[0].message?.content || '';
        } catch (visionErr) {
          console.error("OpenAI vision parse failed on image:", visionErr);
        }
      } else if (isPdf) {
        try {
          if (typeof (global as any).DOMMatrix === 'undefined') {
            (global as any).DOMMatrix = class {};
          }
          const pdfParseModule = require('pdf-parse');
          const PDFParseClass = pdfParseModule.PDFParse;
          
          if (PDFParseClass) {
            // PDF-parse v2 uses a class constructor and expects Uint8Array
            const parser = new PDFParseClass(new Uint8Array(fileBuffer));
            const result = await parser.getText();
            rawText = result.text || '';
          } else {
            // PDF-parse v1 uses direct function execution
            const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
            const pdfData = await pdfParse(fileBuffer);
            rawText = pdfData.text || '';
          }
        } catch (pdfErr: any) {
          console.error("PDF parse failed:", pdfErr);
          rawText = `[Error parsing PDF file: ${pdfErr.message}]`;
        }
      }

      if (rawText) {
        extractedText = rawText;
        status = 'VALIDATED';

        // Check if the parsed text is extremely short, indicating a scanned PDF
        const cleanText = rawText.replace(/[\s\-\d]/g, '');
        const isLikelyScannedPdf = isPdf && cleanText.length < 50;

        let visionOcrSucceeded = false;
        if (isLikelyScannedPdf && process.env.OPENAI_API_KEY) {
          console.log('[Document Route] Scanned PDF detected — using gpt-4o Vision OCR with application/pdf...');
          try {
            // Send PDF directly as application/pdf base64 — GPT-4o supports this natively
            const visionResponse = await openai.chat.completions.create({
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
3. Capture Payer name, Payer TIN/EIN, Recipient name, Recipient TIN/SSN
4. Do NOT summarize. Transcribe the actual text exactly as printed.
5. If multiple copies of the same form appear (Copy B, Copy C), transcribe only ONE copy.`
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:application/pdf;base64,${fileData}`,
                        detail: 'high'
                      }
                    }
                  ]
                }
              ],
              max_tokens: 2000
            });

            const visionText = visionResponse.choices[0].message?.content || '';
            if (visionText && visionText.trim().length > 50) {
              rawText = visionText;
              extractedText = visionText;
              visionOcrSucceeded = true;
              console.log('[Document Route] gpt-4o PDF OCR succeeded. Text length:', visionText.length);
            } else {
              console.warn('[Document Route] gpt-4o PDF OCR returned minimal text. Trying JPEG fallback...');
              // Last resort: try as JPEG in case this is a PDF that embeds a single image page
              const visionResponse2 = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: 'Transcribe ALL text from this tax form precisely. Include form type, box numbers, labels, all dollar values, TINs/SSNs/EINs, and names.'
                      },
                      {
                        type: 'image_url',
                        image_url: {
                          url: `data:application/pdf;base64,${fileData}`,
                          detail: 'high'
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 2000
              });
              const fallbackText = visionResponse2.choices[0].message?.content || '';
              if (fallbackText && fallbackText.trim().length > 50) {
                rawText = fallbackText;
                extractedText = fallbackText;
                visionOcrSucceeded = true;
                console.log('[Document Route] PDF fallback OCR succeeded. Text length:', fallbackText.length);
              } else {
                validationErrors = 'Scanned document could not be parsed. Upload as PNG/JPG for best results.';
              }
            }
          } catch (visionFallbackErr: any) {
            console.error('[Document Route] gpt-4o Vision OCR failed:', visionFallbackErr?.message);
            validationErrors = 'Scanned document could not be parsed. Upload as PNG/JPG for best results.';
          }
        }

        const hasOpenAI = process.env.OPENAI_API_KEY && 
                          process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                          process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

        if (hasOpenAI) {
          try {
            const prompt = `You are an expert CPA Tax Assistant.
Analyze the following raw OCR text extracted from an uploaded client document:
---
${rawText}
---

Your task:
1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
3. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than 2026, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
4. Estimate your parsing confidence score between 0.0 and 1.0.
5. If the document is any form of 1099 (e.g. 1099-R, 1099-G, 1099-B, 1099-K, etc.), always categorize it under its specific 1099 category if listed, or use "1099-UNCLASSIFIED" if it is not one of the specific ones. Never classify a 1099 form as "UNCLASSIFIED".

Format your output as a JSON object with keys:
"category", "aiSummary", "confidenceScore", "validationErrors"`;

            const response = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message?.content || '{}');
            category = result.category || category;
            confidenceScore = result.confidenceScore || confidenceScore;

            if (isLikelyScannedPdf && !visionOcrSucceeded) {
              // Vision OCR failed — add a note so the accountant knows to re-upload as PNG/JPG
              aiSummary = (result.aiSummary || '') + " (Note: This appears to be a scanned document. For best OCR results, upload as PNG/JPG image.)";
              validationErrors = result.validationErrors || "Scanned document detected. Text layer is empty and Vision OCR could not extract content. Re-upload as PNG/JPG for full extraction.";
            } else {
              // Either not a scanned PDF or Vision OCR succeeded — use classifier result cleanly
              aiSummary = result.aiSummary || aiSummary;
              validationErrors = result.validationErrors || null;
            }
          } catch (openaiErr) {
            console.error("OpenAI processing of raw text failed:", openaiErr);
          }
        }
      }
    }

    const document = await prisma.document.create({
      data: {
        name,
        url: '#',
        fileSize,
        fileType,
        taxYear: 2026,
        category,
        status: validationErrors ? 'REVIEW_REQUIRED' : status,
        extractedText,
        aiSummary,
        confidenceScore,
        validationErrors,
        fileData,
        clientId: clientId || null
      }
    });

    // Generate RAG chunks and embeddings
    if (extractedText) {
      try {
        await processDocumentChunks(document.id, extractedText);
      } catch (chunkErr) {
        console.error("Failed to generate document chunks on create:", chunkErr);
      }

      // If document is W2 or 1099, extract tax form fields
      if (document.category === 'W2' || document.category.startsWith('1099') || document.category.includes('1099')) {
        try {
          await extractAndSaveTaxFormData(document.id, document.category, extractedText);
        } catch (tfErr) {
          console.error("Failed to extract tax form data on create:", tfErr);
        }
      }
    }

    return NextResponse.json({ success: true, document });
  } catch (error: any) {
    console.error('Create Document Log Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { docId, category, extractedText, aiSummary, taxYear } = body;

    if (!docId) {
      return NextResponse.json({ success: false, error: "docId is required" }, { status: 400 });
    }

    const document = await prisma.document.update({
      where: { id: docId },
      data: {
        ...(category && { category }),
        ...(extractedText !== undefined && { extractedText }),
        ...(aiSummary && { aiSummary }),
        ...(taxYear && { taxYear: parseInt(taxYear) })
      }
    });

    // Re-generate RAG chunks and embeddings if the text has been edited manually
    if (extractedText !== undefined) {
      try {
        await processDocumentChunks(docId, extractedText);
      } catch (chunkErr) {
        console.error("Failed to update document chunks after PATCH:", chunkErr);
      }
    }

    // Extract tax form fields if category is W2 or 1099 and we have text
    if (document.category === 'W2' || document.category.startsWith('1099') || document.category.includes('1099')) {
      const activeText = extractedText !== undefined ? extractedText : document.extractedText;
      if (activeText) {
        try {
          await extractAndSaveTaxFormData(docId, document.category, activeText);
        } catch (tfErr) {
          console.error("Failed to extract tax form data after PATCH:", tfErr);
        }
      }
    }

    return NextResponse.json({ success: true, document });
  } catch (error: any) {
    console.error('Update Document Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get('docId');

    if (!docId) {
      return NextResponse.json({ success: false, error: "docId is required" }, { status: 400 });
    }

    await prisma.document.delete({
      where: { id: docId }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete Document Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
