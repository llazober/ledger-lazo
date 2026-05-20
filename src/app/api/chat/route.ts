import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { prisma } from '@/lib/prisma';
import { searchKnowledge } from '@/lib/knowledge';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { message, history, documentContext } = await req.json();

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

    let knowledgePrompt = "";
    if (documentContext) {
      // 1. Attempt RAG vector matching for specific document
      const knowledge = await searchKnowledge(message, documentContext.id);
      if (knowledge) {
        knowledgePrompt = `\n\nRELEVANT DOCUMENT EXCERPTS:\n${knowledge}\n\nUse these excerpts to answer the user's question.`;
      } else {
        // Fallback to active document full text (capped to prevent token overflow)
        const fallbackText = documentContext.extractedText?.slice(0, 5000) || "No text extracted from this document.";
        knowledgePrompt = `\n\nACTIVE DOCUMENT TEXT:\n${fallbackText}\n\nUse this text to answer the user's question.`;
      }

      aiInstructions = `You are Lazo, the premium AI Document Assistant for Datalazo Ledger Services.
You are helping an accountant query and inspect a client's tax document.

ACTIVE DOCUMENT DETAILS:
Document Name: ${documentContext.name}
Category: ${documentContext.category}
${knowledgePrompt}

YOUR INSTRUCTIONS:
- Answer the user's question accurately using the document information provided above.
- Be concise, professional, and clear.
- If the user asks about specific fields (e.g. Box 1, Box 5, net benefits, wages), report them exactly as they appear.
- If the information is not in the text/excerpts, politely state that you cannot find it in this document.`;
    } else {
      // Concierge chat: general RAG search across knowledge base
      const knowledge = await searchKnowledge(message);
      if (knowledge) {
        knowledgePrompt = `\n\nRELEVANT KNOWLEDGE BASE INFORMATION:\n${knowledge}\n\nUse this information to answer the question if applicable.`;
      }

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

      // Look up client process status from database based on email or name keywords
      let clientStatusContext = "";
      try {
        const keywords: string[] = [];
        const textsToAnalyze = [message];
        if (safeHistory && safeHistory.length > 0) {
          const lastMessages = safeHistory.slice(-4).map((h: any) => h.content || "");
          textsToAnalyze.push(...lastMessages);
        }
        const combinedText = textsToAnalyze.join(" ");

        const emailMatches = combinedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (emailMatches) {
          keywords.push(...emailMatches);
        }

        const words = combinedText.split(/\s+/).map((w: string) => w.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()).filter((w: string) => w.length > 2);

        const clients = await prisma.client.findMany({
          include: {
            user: true,
            documents: {
              select: {
                name: true,
                category: true,
                status: true
              }
            }
          }
        });

        const matchedClients = clients.filter(c => {
          const emailLower = c.user.email.toLowerCase();
          const nameLower = c.user.name.toLowerCase();
          const companyLower = (c.companyName || "").toLowerCase();

          if (emailMatches && emailMatches.some(email => emailLower.includes(email.toLowerCase()))) {
            return true;
          }

          return words.some(w => {
            if (['the', 'and', 'for', 'status', 'process', 'client', 'company', 'name', 'mail', 'email', 'lazo'].includes(w)) {
              return false;
            }
            return nameLower.includes(w) || companyLower.includes(w) || emailLower.includes(w);
          });
        });

        if (matchedClients.length > 0) {
          clientStatusContext = matchedClients.map(c => {
            const docSummary = c.documents.map(d => `- ${d.name} (${d.category}, Status: ${d.status})`).join('\n');
            return `Client Name: ${c.user.name}
Email: ${c.user.email}
Company: ${c.companyName || 'N/A'}
Tax Type: ${c.taxType}
Current Process Stage: ${c.status}
Status Explanation:
- ONBOARDING: Currently onboarding/setting up their portal.
- MISSING_DOCS: Waiting for required tax documents. We have requested outstanding paperwork.
- IN_PREPARATION: Accountant is preparing their returns.
- REVIEW: Completed and ready for client sign-off.
- COMPLETED: Client signed and filing is completed.
Uploaded Documents:
${docSummary || 'None.'}`;
          }).join('\n\n');
        }
      } catch (err) {
        console.warn("Error looking up client status in database:", err);
      }

      if (clientStatusContext) {
        aiInstructions = `${aiInstructions}${knowledgePrompt}\n\nMATCHING CLIENT DATABASE RECORDS:\n${clientStatusContext}\n\nINSTRUCTION: The user has queried status. Use this real-time database record to give a helpful, precise update. Rephrase status keys nicely (e.g. IN_PREPARATION -> In Preparation).`;
      } else {
        aiInstructions = `${aiInstructions}${knowledgePrompt}\n\nINSTRUCTION: If the user asks about their process, onboarding, or tax status, politely ask them to provide their email address or company name so you can check their real-time file status in the database.`;
      }
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
