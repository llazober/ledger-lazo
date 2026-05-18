import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { clientId, status } = body;

    const client = await prisma.client.update({
      where: { id: clientId },
      data: { status }
    });

    return NextResponse.json({ success: true, client });
  } catch (error: any) {
    console.error('Update Client Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
