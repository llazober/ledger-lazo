import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import mammoth from 'mammoth';
import { processDocumentChunks } from '@/lib/ai-processor';

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
      } else if (originalImage && process.env.OPENAI_API_KEY) {
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
                      url: `data:image/png;base64,${originalImage}`
                    }
                  }
                ]
              }
            ]
          });
          rawText = response.choices[0].message?.content || '';
        } catch (visionErr) {
          console.error("OpenAI vision parse failed on originalImage:", visionErr);
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
                      url: `data:image/${fileExt || 'png'};base64,${fileData}`
                    }
                  }
                ]
              }
            ]
          });
          rawText = response.choices[0].message?.content || '';
        } catch (visionErr) {
          console.error("OpenAI vision parse failed:", visionErr);
        }
      }

      if (rawText) {
        extractedText = rawText;
        status = 'VALIDATED';

        // Check if the parsed text is extremely short, indicating a scanned PDF
        const cleanText = rawText.replace(/[\s\-\d]/g, '');
        const isLikelyScannedPdf = isPdf && cleanText.length < 50;

        if (isLikelyScannedPdf) {
          aiSummary = "Scanned document detected. Standard text layer is empty. Please upload as a PNG/JPG image file for full OCR transcription.";
          validationErrors = "Scanned document detected. Standard text layer is empty. Check manually or upload as PNG/JPG image.";
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
1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
3. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than 2026, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
4. Estimate your parsing confidence score between 0.0 and 1.0.

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

            if (isLikelyScannedPdf) {
              aiSummary = (result.aiSummary || '') + " (Note: This appears to be a scanned document with limited text overlay. For full OCR transcription, please save it as a PNG/JPG image file and upload it again.)";
              validationErrors = result.validationErrors || "Scanned document detected. Standard text layer is empty. Check manually or upload as PNG/JPG image.";
            } else {
              aiSummary = result.aiSummary || aiSummary;
              validationErrors = result.validationErrors || validationErrors;
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
