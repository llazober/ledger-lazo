import React from 'react';

export default function TaxPlanningPage() {
  return (
    <div className="p-6 md:p-8 space-y-6 text-left">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          <span className="gradient-text">RAG Tax Assistant</span>
        </h1>
        <p className="text-slate-400 text-xs mt-1">Cross-reference client document vaults against the Internal Revenue Code (IRC) for personalized tax strategies.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass p-6 space-y-3">
          <h3 className="text-lg font-bold text-white">📖 IRC Section Reference Engine</h3>
          <p className="text-slate-300 text-xs leading-relaxed">
            The active RAG framework indexes the full 2026 Internal Revenue Code, IRS publications, and federal tax court rulings. Ask the chatbot in the Document Vault about:
          </p>
          <ul className="list-disc list-inside text-slate-400 text-xs space-y-1.5 pt-2">
            <li>Section 162: Business deduction verification</li>
            <li>Section 179: Equipment depreciation rules</li>
            <li>Section 199A: Qualified Business Income (QBI) eligibility</li>
            <li>Recent IRS changes for clean vehicle tax credits</li>
          </ul>
        </div>

        <div className="glass p-6 space-y-3">
          <h3 className="text-lg font-bold text-white">🔍 Automated Deduction Scanners</h3>
          <p className="text-slate-300 text-xs leading-relaxed">
            The AI background process continuously scans bank transaction statements and receipt categories to flag tax-saving opportunities.
          </p>
          <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 rounded-xl text-xs flex items-start gap-2.5 mt-2">
            <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <span className="font-bold block text-[10px] uppercase tracking-wider mb-0.5">Active Scanner Alert:</span>
              Detected $12,000 Schedule C Upwork gross income. Automated Section 199A QBI deduction calculations have been queued for draft review.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
