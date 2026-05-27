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
          console.log('[Document Route] Scanned PDF detected — using OpenAI Files API for high-fidelity OCR...');
          try {
            const { performVisionOcrWithFilesApi } = await import('@/lib/openai-pdf-ocr');
            const visionText = await performVisionOcrWithFilesApi(fileBuffer, name || 'document.pdf');
            
            if (visionText && visionText.trim().length > 50) {
              rawText = visionText;
              extractedText = visionText;
              visionOcrSucceeded = true;
              console.log('[Document Route] OpenAI Files API vision OCR succeeded. Text length:', visionText.length);
            } else {
              console.warn('[Document Route] OpenAI Files API vision OCR returned minimal text.');
              validationErrors = 'Scanned PDF could not be fully parsed. Check image quality.';
            }
          } catch (visionFallbackErr: any) {
            console.error('[Document Route] OpenAI Files API vision OCR failed:', visionFallbackErr?.message);
            validationErrors = 'Scanned document could not be parsed. Please try again or check the file quality.';
          }
        }

        const hasOpenAI = process.env.OPENAI_API_KEY && 
                          process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                          process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

        if (hasOpenAI) {
          try {
            const currentYear = new Date().getFullYear();
            const previousYear = currentYear - 1;
            const prompt = `You are an expert CPA Tax Assistant.
Analyze the following raw OCR text extracted from an uploaded client document:
---
${rawText}
---

Your task:
1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
3. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than ${previousYear} or ${currentYear}, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
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

    if (extractedText) {
      // Clear all spaces/hyphens and check for unique OMB control numbers
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
        console.log(`[Document Route] OMB fingerprint matched: ${detectedCategory}. Overriding category.`);
        category = detectedCategory;
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
        status: (validationErrors || category === 'UNCLASSIFIED' || category === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED',
        extractedText,
        aiSummary,
        confidenceScore,
        validationErrors,
        fileData,
        clientId: clientId || null
      }
    });

    let finalDocument = document;

    // Convert PDF pages to companion PNG image documents for manual review (independent of text extraction status)
    const isPdf = fileType?.toLowerCase() === 'pdf' || name?.toLowerCase().endsWith('.pdf');
    if (isPdf && fileData) {
      try {
        console.log(`[Document Route] Converting PDF ${name} to PNG for manual verification...`);
        const { convertPdfToImages } = await import('@/lib/pdf-converter');
        const fileBuffer = Buffer.from(fileData, 'base64');
        const pagesBase64 = await convertPdfToImages(fileBuffer, 4, document.category);
        for (let i = 0; i < pagesBase64.length; i++) {
          const imageBase64 = pagesBase64[i];
          const imageName = pagesBase64.length === 1
            ? `${name.replace(/\.pdf$/i, '')} (Image Verification).png`
            : `${name.replace(/\.pdf$/i, '')} (Image Verification - Page ${i + 1}).png`;
          
          await prisma.document.create({
            data: {
              clientId: document.clientId,
              name: imageName,
              url: '#',
              fileSize: Math.round(imageBase64.length * 0.75),
              fileType: 'PNG',
              taxYear: document.taxYear,
              category: 'UNCLASSIFIED',
              status: 'UPLOADED',
              fileData: imageBase64,
            }
          });
          console.log(`[Document Route] Successfully created companion PNG: ${imageName}`);
        }
      } catch (imgErr) {
        console.error("Failed to generate companion PNG on upload:", imgErr);
      }
    }

    // Generate RAG chunks and embeddings
    if (extractedText) {
      try {
        await processDocumentChunks(document.id, extractedText);
      } catch (chunkErr) {
        console.error("Failed to generate document chunks on create:", chunkErr);
      }

      // If document is W2, 1099, or 1095-A, extract tax form fields from PDF text layer
      if (document.category === 'W2' || document.category.startsWith('1099') || document.category.includes('1099') || document.category === '1095-A' || document.category === '1098') {
        try {
          await extractAndSaveTaxFormData(document.id, document.category, extractedText);
        } catch (tfErr) {
          console.error("Failed to extract tax form data on create:", tfErr);
        }
      }
    }

    return NextResponse.json({ success: true, document: finalDocument });
  } catch (error: any) {
    console.error('Create Document Log Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { docId, category, extractedText, aiSummary, taxYear, reprocess } = body;

    if (!docId) {
      return NextResponse.json({ success: false, error: "docId is required" }, { status: 400 });
    }

    const existingDoc = await prisma.document.findUnique({
      where: { id: docId }
    });

    if (!existingDoc) {
      return NextResponse.json({ success: false, error: "Document not found" }, { status: 404 });
    }

    let activeText = existingDoc.extractedText || '';
    let activeCategory = existingDoc.category || 'UNCLASSIFIED';
    let activeSummary = existingDoc.aiSummary || '';
    let confidenceScore = existingDoc.confidenceScore || 0.0;
    let validationErrors = existingDoc.validationErrors || null;
    let status = existingDoc.status;

    if (reprocess) {
      console.log(`[Reprocess] Triggering Vision OCR re-extraction for document ${docId}...`);
      let rawText = '';
      let visionOcrSucceeded = false;

      const fileBuffer = existingDoc.fileData ? Buffer.from(existingDoc.fileData, 'base64') : null;
      const isPdf = existingDoc.name.toLowerCase().endsWith('.pdf') || existingDoc.fileType?.toUpperCase() === 'PDF';
      const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(existingDoc.fileType?.toLowerCase() || '') ||
                      /\.(png|jpe?g|webp)$/i.test(existingDoc.name);

      if (isPdf && fileBuffer) {
        try {
          console.log(`[Reprocess] Running OpenAI Files API OCR for PDF document ${docId}...`);
          const { performVisionOcrWithFilesApi } = await import('@/lib/openai-pdf-ocr');
          const visionText = await performVisionOcrWithFilesApi(fileBuffer, existingDoc.name);
          
          if (visionText && visionText.trim().length > 10) {
            rawText = visionText;
            visionOcrSucceeded = true;
            console.log(`[Reprocess] OpenAI Files API vision OCR succeeded! Total transcribed chars: ${visionText.length}`);
          }
        } catch (pdfErr: any) {
          console.error('[Reprocess] OpenAI Files API vision OCR failed:', pdfErr);
        }
      } else if (isImage && existingDoc.fileData) {
        try {
          console.log(`[Reprocess] Running GPT-4o Vision OCR on uploaded image...`);
          const fileExt = existingDoc.fileType.toLowerCase();
          const mimeType = fileExt === 'jpg' || fileExt === 'jpeg' ? 'image/jpeg' : `image/${fileExt}`;
          
          const visionResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Transcribe ALL visible text from the following document image. Perform high-fidelity OCR, preserving all headers, forms, labels, tables, key-value pairs, numbers, boxes, and SSNs/EINs exactly as printed.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${existingDoc.fileData}`
                  }
                }
              ]
            }],
            max_tokens: 4000
          });

          const visionText = visionResponse.choices[0].message?.content || '';
          if (visionText && visionText.trim().length > 10) {
            rawText = visionText;
            visionOcrSucceeded = true;
            console.log(`[Reprocess] GPT-4o Vision OCR succeeded on image!`);
          }
        } catch (imgErr: any) {
          console.error('[Reprocess] Image Vision OCR failed:', imgErr);
        }
      }

      if (visionOcrSucceeded && rawText) {
        activeText = rawText;
        
        const hasOpenAI = process.env.OPENAI_API_KEY && 
                          process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                          process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

        if (hasOpenAI) {
          try {
            const currentYear = new Date().getFullYear();
            const previousYear = currentYear - 1;
            const prompt = `You are an expert CPA Tax Assistant.
Analyze the following raw OCR text extracted from an uploaded client document:
---
${rawText}
---

Your task:
1. Classify the document category into one of these exact options: "W2", "1099-NEC", "1099-SSA", "1099-INT", "1099-DIV", "1099-MISC", "1099-R", "1099-K", "1099-B", "1099-G", "1099-UNCLASSIFIED", "1095-A", "1098", "Bank_Statement", "Receipt", "Tax_Notice", "UNCLASSIFIED".
2. Generate a 1-sentence professional summary (aiSummary) of the document's contents.
3. Check for any validation errors or discrepancies (e.g. if the document refers to a tax year other than ${previousYear} or ${currentYear}, or if crucial information is illegible or missing). Set validationErrors to a descriptive string if any issues are found, otherwise set it to null.
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
            activeCategory = result.category || activeCategory;
            activeSummary = result.aiSummary || activeSummary;
            confidenceScore = result.confidenceScore || confidenceScore;
             validationErrors = result.validationErrors || null;
             status = (validationErrors || activeCategory === 'UNCLASSIFIED' || activeCategory === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED';
          } catch (openaiErr) {
            console.error("[Reprocess] OpenAI processing of raw text failed:", openaiErr);
          }
        }
      } else {
        return NextResponse.json({ success: false, error: "Vision OCR could not transcribe text from document image data." }, { status: 422 });
      }
    }

    let document;
    if (reprocess) {
      document = await prisma.document.update({
        where: { id: docId },
        data: {
          category: activeCategory,
          extractedText: activeText,
          aiSummary: activeSummary,
          confidenceScore,
          validationErrors,
          status
        }
      });
    } else {
      let statusToUpdate = undefined;
      if (category) {
        statusToUpdate = (category === 'UNCLASSIFIED' || category === '1099-UNCLASSIFIED') ? 'REVIEW_REQUIRED' : 'VALIDATED';
      }

      document = await prisma.document.update({
        where: { id: docId },
        data: {
          ...(category && { category }),
          ...(statusToUpdate && { status: statusToUpdate }),
          ...(extractedText !== undefined && { extractedText }),
          ...(aiSummary && { aiSummary }),
          ...(taxYear && { taxYear: parseInt(taxYear) })
        }
      });
    }

    // Re-generate RAG chunks and embeddings
    const activeTextVal = reprocess ? activeText : extractedText;
    if (activeTextVal !== undefined) {
      try {
        await processDocumentChunks(docId, activeTextVal);
      } catch (chunkErr) {
        console.error("Failed to update document chunks after PATCH:", chunkErr);
      }
    }

    // Extract tax form fields if category is W2, 1099, 1095-A, or 1098 and we have text
    if (document.category === 'W2' || document.category.startsWith('1099') || document.category.includes('1099') || document.category === '1095-A' || document.category === '1098') {
      const activeTextForForm = reprocess ? activeText : (extractedText !== undefined ? extractedText : document.extractedText);
      if (activeTextForForm) {
        try {
          await extractAndSaveTaxFormData(docId, document.category, activeTextForForm);
        } catch (tfErr) {
          console.error("Failed to extract tax form data after PATCH:", tfErr);
        }
      }
    }

    // Fetch updated document with relation loaded to return to UI
    const updatedDocument = await prisma.document.findUnique({
      where: { id: docId },
      include: {
        taxFormData: true
      }
    });

    return NextResponse.json({ success: true, document: updatedDocument });
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
