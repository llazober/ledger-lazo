import React from 'react';
import Link from 'next/link';
import ChatAgent from '@/components/ChatAgent';

export default function ClientLandingPage() {
  const portalFeatures = [
    {
      title: '📁 Secure Document Vault (OCR)',
      desc: 'Drop your W-2s, 1099s, and monthly bank statements directly. Our AI instantly extracts key tax categories, flags discrepancies, and drafts summaries for your accountant.',
      icon: '🔐'
    },
    {
      title: '🤖 Cognitive Tax Planner (RAG)',
      desc: 'Ask your personal portal assistant complex questions about your specific documents (e.g. Schedule C deductions, Section 199A eligibility, or entity structures).',
      icon: '🧠'
    },
    {
      title: '⏰ Deadline Tracking & Reminders',
      desc: 'Stay compliant with federal and state tax timelines. Get automatic alerts for missing paperwork, and schedule rapid discovery sessions directly with your dedicated CPA.',
      icon: '📅'
    }
  ];

  return (
    <div className="min-h-screen bg-[#06070a] text-white flex flex-col items-center justify-center p-6 md:p-12 relative overflow-hidden font-sans">
      <div className="absolute inset-0 bg-radial-gradient from-cyan-500/5 to-transparent pointer-events-none" />
      
      {/* Container */}
      <div className="w-full max-w-5xl space-y-12 relative z-10 text-center">
        {/* Header Block */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-cyan-400 shadow-md">
            🔒 SECURE CLIENT ENCRYPTED GATEWAY
          </div>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-none">
            Datalazo Ledger <br className="hidden md:inline" />
            <span className="gradient-text font-black italic">Client Portal Operations</span>
          </h1>
          
          <p className="text-slate-400 text-xs md:text-sm max-w-2xl mx-auto leading-relaxed">
            Welcome to your secure financial cockpit. Upload tax documents, review auto-filled filings, coordinate with your advisory team, and leverage private vector tax-planning models.
          </p>
        </div>

        {/* Enter Portal CTA */}
        <div className="flex justify-center">
          <Link 
            href="/dashboard"
            className="px-8 py-4 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-xs font-extrabold tracking-widest uppercase rounded-2xl hover:brightness-110 transition-all duration-300 shadow-[0_0_30px_rgba(0,240,255,0.4)]"
          >
            🔑 ENTER SECURE CLIENT PORTAL
          </Link>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          {portalFeatures.map(feat => (
            <div 
              key={feat.title}
              className="glass p-6 text-left border border-white/5 hover:border-cyan-500/20 rounded-3xl flex flex-col justify-between transition-all duration-300"
            >
              <div className="space-y-3">
                <div className="text-2xl">{feat.icon}</div>
                <h3 className="text-sm font-bold text-white uppercase tracking-tight">{feat.title}</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-sans">{feat.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Sub-Footer */}
        <div className="text-[10px] text-slate-600 font-semibold tracking-wider uppercase pt-6">
          🛡️ AES-256 BANK-GRADE ENCRYPTION • ISOLATED CLIENT DATABASES • WHITE-LABELED SECURE SAAS
        </div>
      </div>

      <ChatAgent />
    </div>
  );
}
