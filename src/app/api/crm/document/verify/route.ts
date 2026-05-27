import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const { documentId, boxes, humanVerified } = await req.json();

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    // 1. Fetch document to ensure it exists and get details
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 2. Update document verification status and set status to VALIDATED if humanVerified
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        humanVerified: !!humanVerified,
        status: humanVerified ? 'VALIDATED' : document.status,
      },
    });

    // 3. Upsert TaxFormData associated with the document
    let updatedTaxFormData = null;
    if (boxes) {
      // Clean numeric string fields into numbers where applicable
      const cleanedBoxes: Record<string, any> = {};
      for (const [key, value] of Object.entries(boxes)) {
        if (value === '' || value === null) {
          cleanedBoxes[key] = null;
        } else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
          // If it's a numeric field we can save it as number
          cleanedBoxes[key] = Number(value);
        } else {
          cleanedBoxes[key] = value;
        }
      }

      updatedTaxFormData = await prisma.taxFormData.upsert({
        where: { documentId },
        update: {
          boxes: cleanedBoxes,
        },
        create: {
          documentId,
          formType: document.category === 'UNCLASSIFIED' ? 'W2' : document.category, // fallback category
          boxes: cleanedBoxes,
        },
      });
    }

    return NextResponse.json({
      success: true,
      document: updatedDocument,
      taxFormData: updatedTaxFormData,
    });
  } catch (error: any) {
    console.error('Error verifying document:', error);
    return NextResponse.json({ error: error.message || 'Failed to verify document' }, { status: 500 });
  }
}
