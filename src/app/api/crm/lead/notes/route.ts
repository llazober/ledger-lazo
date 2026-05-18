import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { leadId, notes } = body;

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: { notes }
    });

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    console.error('Update Lead Notes Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
