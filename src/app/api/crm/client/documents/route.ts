import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
    }

    const documents = await prisma.document.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        fileType: true,
        fileSize: true,
        taxYear: true,
        category: true,
        status: true,
        humanVerified: true,
        createdAt: true
      }
    });

    return NextResponse.json({ success: true, documents });
  } catch (error: any) {
    console.error('Fetch Client Docs Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
