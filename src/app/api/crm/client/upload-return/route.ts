import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const clientId = formData.get('clientId') as string;
    const file = formData.get('file') as File;

    if (!clientId || !file) {
      return NextResponse.json({ success: false, error: "clientId and file are required" }, { status: 400 });
    }

    // Convert file to base64 string
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Data = buffer.toString('base64');

    // Create Document record
    const document = await prisma.document.create({
      data: {
        clientId,
        name: file.name || 'completed_tax_return.pdf',
        url: '#', // Will update after creation with the safe download URL
        fileType: 'PDF',
        fileSize: file.size,
        taxYear: 2026,
        category: 'Tax_Return',
        status: 'VALIDATED',
        extractedText: `Final prepared tax return for review. Uploaded by CPA preparer. Size: ${(file.size / 1024).toFixed(1)} KB.`,
        aiSummary: `Completed tax return PDF ready for client sign-off and approval.`,
        confidenceScore: 1.0,
        fileData: base64Data
      }
    });

    // Update the URL to use our new download route
    const downloadUrl = `/accounting/api/crm/document/download?docId=${document.id}`;
    const updatedDoc = await prisma.document.update({
      where: { id: document.id },
      data: { url: downloadUrl }
    });

    // Automatically transition Client status to REVIEW (In Review)
    const client = await prisma.client.update({
      where: { id: clientId },
      data: { status: 'REVIEW' },
      include: { user: true }
    });

    // Notify n8n of the status change and include document links
    if (process.env.N8N_WEBHOOK_URL) {
      fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          event: 'CLIENT_STATUS_CHANGED', 
          status: 'REVIEW', 
          clientId, 
          clientName: client.user.name,
          clientEmail: client.user.email,
          taxType: client.taxType,
          taxYear: client.taxYear,
          documentId: updatedDoc.id,
          documentName: updatedDoc.name,
          downloadUrl: `https://portal.datalazo.net/accounting/api/crm/document/download?docId=${updatedDoc.id}`
        }),
      }).catch(err => console.error("N8n status webhook notification failed:", err));
    }

    return NextResponse.json({ 
      success: true, 
      document: updatedDoc,
      message: "Tax return uploaded successfully. Client status updated to REVIEW."
    });

  } catch (error: any) {
    console.error('Upload Return Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
