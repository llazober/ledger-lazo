import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get('docId');

    if (!docId) {
      return new Response("docId is required", { status: 400 });
    }

    const document = await prisma.document.findUnique({
      where: { id: docId }
    });

    if (!document) {
      return new Response("Document not found", { status: 404 });
    }

    const preview = searchParams.get('preview') === 'true';

    // 1. If we have database base64 encoded file data
    if (document.fileData) {
      const fileBuffer = Buffer.from(document.fileData, 'base64');
      
      let contentType = 'application/octet-stream';
      if (document.fileType === 'PDF') contentType = 'application/pdf';
      else if (document.fileType === 'JPG' || document.fileType === 'JPEG') contentType = 'image/jpeg';
      else if (document.fileType === 'PNG') {
        if (document.fileData && document.fileData.startsWith('/9j/')) {
          contentType = 'image/jpeg';
        } else {
          contentType = 'image/png';
        }
      }

      const disposition = preview ? 'inline' : `attachment; filename="${document.name}"`;

      return new Response(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': disposition,
        }
      });
    }

    // 2. If it is a mock document with NO binary data, generate a dynamic text file with the OCR transcript
    const fileContent = `DOCUMENT TRANSCRIPT REPORT
==================================================
File Name: ${document.name}
Category: ${document.category}
Tax Period: TY ${document.taxYear}
Confidence: ${Math.round(document.confidenceScore * 100)}%
Status: ${document.status}
Uploaded At: ${document.createdAt.toISOString()}
==================================================

OCR EXTRACTED TRANSCRIPT:
--------------------------------------------------
${document.extractedText || "No transcript text available for this file."}

--------------------------------------------------
CPA SYSTEM AUTOMATED TRANSCRIPT GENERATOR
`;

    const textBuffer = Buffer.from(fileContent, 'utf-8');
    const safeName = document.name.endsWith('.txt') ? document.name : `${document.name.replace(/\.[^/.]+$/, "")}.txt`;
    const disposition = preview ? 'inline' : `attachment; filename="${safeName}"`;

    return new Response(textBuffer, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': disposition,
      }
    });

  } catch (error: any) {
    console.error('Download Document Error:', error);
    return new Response(`Error downloading document: ${error.message}`, { status: 500 });
  }
}
