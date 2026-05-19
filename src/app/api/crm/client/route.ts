import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { clientId, status, positions } = body;

    if (positions && Array.isArray(positions)) {
      // Transaction to update all positions & statuses
      await prisma.$transaction(
        positions.map((p: { id: string; position: number; status: string }) =>
          prisma.client.update({
            where: { id: p.id },
            data: { 
              position: p.position,
              status: p.status
            }
          })
        )
      );

      // Notify n8n of status change for the dragged client if status changed
      if (clientId && status && process.env.N8N_WEBHOOK_URL) {
        const client = await prisma.client.findUnique({
          where: { id: clientId },
          include: { user: true }
        });
        if (client) {
          fetch(process.env.N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              event: 'CLIENT_STATUS_CHANGED', 
              status, 
              clientId, 
              clientName: client.user.name,
              clientEmail: client.user.email,
              taxType: client.taxType,
              taxYear: client.taxYear
            }),
          }).catch(err => console.error("N8n status webhook notification failed:", err));
        }
      }

      return NextResponse.json({ success: true });
    }

    const client = await prisma.client.update({
      where: { id: clientId },
      data: { status },
      include: { user: true }
    });

    // Notify n8n of the status change if configured
    if (process.env.N8N_WEBHOOK_URL) {
      fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          event: 'CLIENT_STATUS_CHANGED', 
          status, 
          clientId, 
          clientName: client.user.name,
          clientEmail: client.user.email,
          taxType: client.taxType,
          taxYear: client.taxYear
        }),
      }).catch(err => console.error("N8n status webhook notification failed:", err));
    }

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
