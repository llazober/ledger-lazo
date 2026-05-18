import React from 'react';

export default function SettingsPage() {
  return (
    <div className="p-6 md:p-8 space-y-6 text-left">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          <span className="gradient-text">System Settings</span>
        </h1>
        <p className="text-slate-400 text-xs mt-1">Configure global integration parameters for your single-client droplet ecosystem. Changes here affect outbound notifications and scheduling systems.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Core Integration Settings */}
        <div className="glass p-6 space-y-5">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">🔑 Core API Integrations</h3>
          
          <div className="space-y-4 text-xs font-sans">
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">OpenAI API Authorization Key</label>
              <input 
                type="password" 
                disabled
                className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-400 text-xs"
                value="••••••••••••••••••••••••••••••••••••"
              />
              <span className="text-[9px] text-slate-500 mt-1 block">Used for OCR text extraction, summaries, and vector RAG querying.</span>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Resend Email Gateway Key</label>
              <input 
                type="password" 
                disabled
                className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-400 text-xs"
                value="••••••••••••••••••••••••••••••••••••"
              />
              <span className="text-[9px] text-slate-500 mt-1 block">Enables high-deliverability client onboarding notices and missing-doc reminders.</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Twilio Account SID</label>
                <input 
                  type="text" 
                  disabled
                  className="w-full bg-[#0a0a0c] border border-white/5 rounded-xl p-3 text-slate-400 text-xs"
                  value="AC890a82b13c"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Twilio Token</label>
                <input 
                  type="password" 
                  disabled
                  className="w-full bg-[#0a0a0c] border border-white/5 rounded-xl p-3 text-slate-400 text-xs"
                  value="••••••••••••••••••••••••"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Global Branding & n8n settings */}
        <div className="glass p-6 flex flex-col justify-between space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">🌐 Firm Identity & Automation</h3>
            
            <div className="space-y-4 text-xs font-sans mt-5">
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Firm Brand Name</label>
                <input 
                  type="text" 
                  disabled
                  className="w-full bg-[#0a0a0c] border border-white/5 rounded-xl p-3 text-slate-200 text-xs"
                  value="Datalazo Ledger Services"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Sender Email Domain</label>
                <input 
                  type="text" 
                  disabled
                  className="w-full bg-[#0a0a0c] border border-white/5 rounded-xl p-3 text-slate-200 text-xs"
                  value="office@datalazo.net"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">n8n Webhook Endpoint Trigger</label>
                <input 
                  type="text" 
                  disabled
                  className="w-full bg-[#0a0a0c] border border-white/5 rounded-xl p-3 text-slate-400 text-xs font-mono"
                  value="http://161.35.119.223:5678/webhook/ledger"
                />
                <span className="text-[9px] text-slate-500 mt-1 block">Coordinates workflows across WhatsApp, SMS, and Calendar reminders automatically.</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <button className="w-full py-2.5 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-[10px] font-bold uppercase rounded-lg">
              Save Global Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
