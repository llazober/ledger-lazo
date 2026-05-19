import React from 'react';
import { prisma } from '@/lib/prisma';
import CRMManager from '@/components/CRMManager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const clients = await prisma.client.findMany({
      include: {
        user: true
      },
      orderBy: [
        { position: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    // Serialize Dates to string to pass safely to Client Components
    const serializedLeads = leads.map((lead: any) => ({
      ...lead,
      notes: lead.notes || null,
      aiDossier: lead.aiDossier || null,
      company: lead.company || null,
      phone: lead.phone || null,
      createdAt: lead.createdAt.toISOString()
    }));

    const serializedClients = clients.map((client: any) => ({
      ...client,
      companyName: client.companyName || null,
      createdAt: client.createdAt.toISOString(),
      user: {
        id: client.user.id,
        email: client.user.email,
        name: client.user.name,
        phone: client.user.phone || null,
      }
    }));

    return (
      <div className="space-y-6">
        {/* Header Block */}
        <div className="p-6 md:p-8 pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
              <span className="gradient-text">CPA Command Cockpit</span>
            </h1>
            <p className="text-slate-400 text-xs mt-1">Manage local scraping leads, tax workflows, and discovery profiles from a single secure operations center.</p>
          </div>
        </div>

        <CRMManager 
          initialLeads={serializedLeads} 
          initialClients={serializedClients} 
        />
      </div>
    );
  } catch (error) {
    console.error('Dashboard Data Fetch Error:', error);
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center p-6 space-y-4">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-2 border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">Database Core Connection Failure</h1>
        <p className="text-slate-400 text-xs max-w-sm mx-auto leading-relaxed">
          The CPA platform was unable to establish a secure database bridge to `ledger_lazo`. Please ensure your environment settings are valid and the remote PostgreSQL host is active.
        </p>
      </div>
    );
  }
}
