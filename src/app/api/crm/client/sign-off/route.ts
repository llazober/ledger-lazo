import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Webhook Handler for Client Sign-Off/Completed returns
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clientId, email } = body;

    if (!clientId && !email) {
      return NextResponse.json({ success: false, error: "Either clientId or email is required" }, { status: 400 });
    }

    let client = null;
    let user = null;

    if (clientId) {
      client = await prisma.client.findUnique({
        where: { id: clientId },
        include: { user: true }
      });
      if (client) {
        user = client.user;
      }
    } else if (email) {
      user = await prisma.user.findUnique({
        where: { email }
      });
      if (user) {
        client = await prisma.client.findUnique({
          where: { userId: user.id }
        });
      }
    }

    if (!client || !user) {
      return NextResponse.json({ success: false, error: "Client profile not found" }, { status: 404 });
    }

    // Update Client status to COMPLETED
    const updatedClient = await prisma.client.update({
      where: { id: client.id },
      data: { status: 'COMPLETED' }
    });

    return NextResponse.json({
      success: true,
      clientId: updatedClient.id,
      clientName: user.name,
      clientStatus: updatedClient.status
    });

  } catch (error: any) {
    console.error('Client Sign-Off Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
