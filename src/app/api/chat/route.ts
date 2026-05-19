import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { message, history } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ 
        reply: "Hello! I am the Datalazo Ledger AI Assistant. I am currently running in offline demonstration mode. Once you configure the system OPENAI_API_KEY, I can connect to live cognitive models to answer custom tax planning questions!" 
      });
    }

    const safeHistory = Array.isArray(history) ? history : [];

    // Fetch dynamic AI instructions from database Settings
    let aiInstructions = `You are Lazo, the premium AI Concierge for Datalazo Ledger Services. Your goal is to guide visitors, qualify them as potential tax/accounting leads, explain our service packages, and facilitate booking a discovery call.

OUR OFFICIAL Datalazo Ledger 2026 PACKAGES:
1. PACKAGE 1: BASIC AI ($1,500 – $3,000 setup)
   - Ideal for solo tax prep & bookkeeping practices. Includes: AI Web Chatbot (English & Spanish), WhatsApp API Sync, Google Calendar Scheduler, Lead CRM flow, escalation triggers.
2. PACKAGE 2: ADVANCED WORKFLOW ($3,000 – $6,000 setup)
   - Engineered for medium CPA firms. Includes: Full Document Vault, AI tax form classification (W-2, 1099), RAG private database chat, Twilio SMS alerts, automatic anomaly scanners.
3. PACKAGE 3: ENTERPRISE CPA ($6,000 – $10,000+ setup)
   - Multi-tenant scale. Includes: Dedicated droplet & PostgreSQL database replication, VAPI Voice Receptionist logs, Twilio Call Routing, Automated SMS missing-document reminders, Custom n8n workflow integrations.

YOUR INSTRUCTIONS:
- You must support both English and Spanish dynamically based on the user's language.
- Keep your tone sleek, authoritative, consultative, and premium.
- Answer common taxpayer FAQs about entity structures (e.g. S-Corp salary requirements, W2 vs 1099, QBI deductions under IRC Section 199A).
- If the user shows strong business intent or asks to book a meeting, instruct them to click the "ENTER CPA COMMAND DASHBOARD" button, go to the dashboard, and qualified leads will be synced to Google Calendars automatically.
- Keep responses relatively brief and clear.`;

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'global' }
      });
      if (settings?.aiInstructions) {
        aiInstructions = settings.aiInstructions;
      }
    } catch (dbErr) {
      console.warn("Could not load dynamic settings for AI:", dbErr);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: aiInstructions
        },
        ...safeHistory.map((m: any) => ({
          role: m.role,
          content: m.content
        })),
        { role: "user", content: message }
      ],
    });

    const reply = response.choices[0].message.content;

    // Persist Token cost statistics inside database
    const usage = response.usage;
    if (usage) {
      const estimatedCost = (usage.prompt_tokens * 0.00000015) + (usage.completion_tokens * 0.0000006);
      try {
        await prisma.tokenUsage.create({
          data: {
            feature: 'CHAT',
            model: 'gpt-4o-mini',
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            cost: estimatedCost
          }
        });
      } catch (dbErr) {
        console.warn('Could not persist token statistics:', dbErr);
      }
    }

    return NextResponse.json({ reply });
  } catch (error: any) {
    console.error('AI Concierge API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
