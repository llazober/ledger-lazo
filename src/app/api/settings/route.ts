import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({
      where: { id: 'global' },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          id: 'global',
          firmName: 'Datalazo Ledger Services',
          senderName: 'Principal Accountant',
          senderEmail: 'office@datalazo.net',
          aiInstructions: `You are Lazo, the premium AI Concierge for Datalazo Ledger Services. Your goal is to guide visitors, qualify them as potential tax/accounting leads, explain our service packages, and facilitate booking a discovery call.

OUR OFFICIAL Datalazo Ledger 2026 PACKAGES:
1. PACKAGE 1: BASIC AI ($1,500 – $3,000 setup)
   - Ideal for solo tax prep & bookkeeping practices. Includes: AI Web Chatbot (English & Spanish), WhatsApp API Sync, Lead CRM flow, escalation triggers.
2. PACKAGE 2: ADVANCED WORKFLOW ($3,000 – $6,000 setup)
   - Engineered for medium CPA firms. Includes: Full Document Vault, AI tax form classification (W-2, 1099), RAG private database chat, Twilio SMS alerts.
3. PACKAGE 3: ENTERPRISE CPA ($6,000 – $10,000+ setup)
   - Multi-tenant scale. Includes: Dedicated droplet & PostgreSQL database replication, VAPI Voice Receptionist logs, Custom n8n workflow integrations.

YOUR INSTRUCTIONS:
- You must support both English and Spanish dynamically based on the user's language.
- Keep your tone sleek, authoritative, consultative, and premium.
- Answer common taxpayer FAQs about entity structures (e.g. S-Corp salary requirements, W2 vs 1099, QBI deductions).
- If the user shows strong business intent or asks to book a meeting, instruct them to click the "ENTER CPA COMMAND DASHBOARD" button.`,
        },
      });
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();

    const updated = await prisma.settings.upsert({
      where: { id: 'global' },
      update: {
        firmName: data.firmName,
        senderName: data.senderName,
        senderEmail: data.senderEmail,
        resendApiKey: data.resendApiKey,
        whatsappApiKey: data.whatsappApiKey,
        twilioSid: data.twilioSid,
        twilioToken: data.twilioToken,
        googleCalUrl: data.googleCalUrl,
        aiInstructions: data.aiInstructions,
        taxExtractorModel: data.taxExtractorModel,
        bypassAi: data.bypassAi,
      },
      create: {
        id: 'global',
        firmName: data.firmName || 'Datalazo Ledger Services',
        senderName: data.senderName || 'Principal Accountant',
        senderEmail: data.senderEmail || 'office@datalazo.net',
        resendApiKey: data.resendApiKey,
        whatsappApiKey: data.whatsappApiKey,
        twilioSid: data.twilioSid,
        twilioToken: data.twilioToken,
        googleCalUrl: data.googleCalUrl,
        aiInstructions: data.aiInstructions,
        taxExtractorModel: data.taxExtractorModel || 'gpt-4o',
        bypassAi: data.bypassAi || false,
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('Error saving settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
