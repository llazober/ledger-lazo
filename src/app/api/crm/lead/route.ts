import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 1. Create a mock lead
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, company, phone, source, notes } = body;

    const lead = await prisma.lead.create({
      data: {
        name,
        email,
        company: company || null,
        phone: phone || null,
        source: source || 'WEBSITE',
        status: 'NEW',
        notes: notes || null,
      }
    });

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    console.error('Create Lead Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 2. Change lead status (If WON, auto-generate user and client profile)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { leadId, status } = body;

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: { status }
    });

    let newClient = null;

    if (status === 'WON') {
      // 1. Check if user already exists
      let user = await prisma.user.findUnique({
        where: { email: lead.email }
      });

      if (!user) {
        // Create user profile
        user = await prisma.user.create({
          data: {
            email: lead.email,
            name: lead.name,
            passwordHash: "$2b$10$vN9m21U1qC24V4z87V5MJuN1qC24V4z87V5MJuNz39281nS1z.dKe", // Mock password hash
            role: 'CLIENT_USER',
            phone: lead.phone || null,
            isActive: true
          }
        });
      }

      // 2. Check if client profile already exists
      let client = await prisma.client.findUnique({
        where: { userId: user.id }
      });

      if (!client) {
        // Create client account
        client = await prisma.client.create({
          data: {
            userId: user.id,
            companyName: lead.company || 'Individual Taxpayer',
            taxType: '1120S',
            taxYear: 2026,
            status: 'ONBOARDING'
          }
        });
      }

      // Format response structure to reflect User relation
      newClient = {
        ...client,
        createdAt: client.createdAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone || null
        }
      };

      // Also trigger a background mock n8n onboarding webhook if configured
      if (process.env.N8N_WEBHOOK_URL) {
        fetch(process.env.N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'ONBOARDING_TRIGGERED', lead, client, user }),
        }).catch(err => console.error("Optional n8n webhook notify failed:", err));
      }
    }

    return NextResponse.json({ success: true, lead, newClient });
  } catch (error: any) {
    console.error('Update Lead Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get('leadId');

    if (!leadId) {
      return NextResponse.json({ success: false, error: "leadId is required" }, { status: 400 });
    }

    await prisma.lead.delete({
      where: { id: leadId }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete Lead Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
