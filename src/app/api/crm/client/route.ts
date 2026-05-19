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

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId }
    });

    if (client) {
      // Deleting user Cascades and deletes the Client profile
      await prisma.user.delete({
        where: { id: client.userId }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete Client Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
