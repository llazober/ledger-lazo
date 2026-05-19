import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      name, 
      fileSize, 
      fileType, 
      category, 
      status, 
      extractedText, 
      aiSummary, 
      confidenceScore, 
      validationErrors 
    } = body;

    const document = await prisma.document.create({
      data: {
        name,
        url: '#',
        fileSize,
        fileType,
        taxYear: 2026,
        category: category || 'UNCLASSIFIED',
        status: status || 'UPLOADED',
        extractedText: extractedText || null,
        aiSummary: aiSummary || null,
        confidenceScore: confidenceScore || 0.0,
        validationErrors: validationErrors || null
      }
    });

    return NextResponse.json({ success: true, document });
  } catch (error: any) {
    console.error('Create Document Log Error:', error);
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
