import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { convertPdfToImages } from '@/lib/pdf-converter';

export async function GET() {
  const diagnostic: Record<string, any> = {
    docFound: false,
    imagesLength: 0,
    error: null,
    stack: null
  };

  try {
    const doc = await prisma.document.findFirst({
      where: { name: 'LuisMartah1099pension2025.pdf' }
    });

    if (!doc) {
      diagnostic.error = "Document not found";
      return NextResponse.json(diagnostic);
    }

    diagnostic.docFound = true;
    if (!doc.fileData) {
      diagnostic.error = "Document has no file data";
      return NextResponse.json(diagnostic);
    }

    const fileBuffer = Buffer.from(doc.fileData, 'base64');
    const images = await convertPdfToImages(fileBuffer, 1);
    diagnostic.imagesLength = images.length;
  } catch (err: any) {
    diagnostic.error = err.message || String(err);
    diagnostic.stack = err.stack;
  }

  return NextResponse.json(diagnostic);
}

