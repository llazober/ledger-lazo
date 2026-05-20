import React from 'react';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TaxPlanningPage() {
  let scannerAlerts: { id: string; clientName: string; documentName: string; summary: string; category: string }[] = [];
  
  try {
    // Fetch documents that indicate a tax situation or require attention
    const docs = await prisma.document.findMany({
      where: {
        OR: [
          { category: { in: ['W2', '1099-NEC', '1099-INT', '1099-DIV', '1099-R', '1099-MISC', '1099-B', 'SSA-1099'] } },
          { status: 'REVIEW_REQUIRED' }
        ]
      },
      include: {
        client: {
          include: {
            user: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    scannerAlerts = docs.map(d => ({
      id: d.id,
      clientName: d.client?.user.name || 'System Portal',
      documentName: d.name,
      summary: d.aiSummary || 'Document processed and categorized.',
      category: d.category || 'UNCLASSIFIED'
    }));
  } catch (err) {
    console.error("Failed to load active scanner alerts from DB:", err);
  }

  return (
    <div className="p-6 md:p-8 space-y-6 text-left">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          <span className="gradient-text">RAG Tax Assistant</span>
        </h1>
        <p className="text-slate-400 text-xs mt-1">Cross-reference client document vaults against the Internal Revenue Code (IRC) for personalized tax strategies.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: IRC Engine Details */}
        <div className="glass p-6 space-y-3">
          <h3 className="text-lg font-bold text-white">📖 IRC Section Reference Engine</h3>
          <p className="text-slate-300 text-xs leading-relaxed">
            The active RAG framework indexes the full 2026 Internal Revenue Code, IRS publications, and federal tax court rulings. Ask the chatbot in the Document Vault about:
          </p>
          <ul className="list-disc list-inside text-slate-400 text-xs space-y-1.5 pt-2">
            <li><strong className="text-cyan-400">Section 162</strong>: Business deduction verification</li>
            <li><strong className="text-cyan-400">Section 179</strong>: Equipment depreciation rules</li>
            <li><strong className="text-cyan-400">Section 199A</strong>: Qualified Business Income (QBI) eligibility</li>
            <li><strong className="text-cyan-400">Clean Vehicle Credits</strong>: Sourcing and MSRP tax limits</li>
          </ul>
        </div>

        {/* Right Column: Automated Scanners */}
        <div className="glass p-6 space-y-3">
          <h3 className="text-lg font-bold text-white">🔍 Automated Deduction Scanners</h3>
          <p className="text-slate-300 text-xs leading-relaxed">
            The AI background process continuously scans bank transaction statements and receipt categories to flag tax-saving opportunities.
          </p>

          <div className="space-y-3 pt-2">
            {scannerAlerts.length > 0 ? (
              scannerAlerts.map(alert => (
                <div key={alert.id} className="p-4 bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 rounded-xl text-xs flex items-start gap-2.5 shadow-md">
                  <div className="w-5 h-5 bg-emerald-500/10 rounded-full flex items-center justify-center shrink-0 border border-emerald-500/20">
                    <span className="text-[10px]">✓</span>
                  </div>
                  <div className="space-y-1">
                    <span className="font-extrabold text-[9px] uppercase tracking-wider block text-slate-400">
                      Active Scanner Alert — Client: {alert.clientName}
                    </span>
                    <span className="block font-semibold text-white">
                      File: {alert.documentName} ({alert.category})
                    </span>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      {alert.summary} {alert.category === '1099-NEC' && 'Section 199A QBI deduction calculations have been queued for draft review.'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 bg-white/5 border border-white/10 text-slate-400 rounded-xl text-xs text-center">
                No active document flags detected. Upload W-2s, 1099s, or statements to start scans.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
