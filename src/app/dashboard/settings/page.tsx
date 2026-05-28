'use client';

import React, { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [firmName, setFirmName] = useState('Datalazo Ledger Services');
  const [senderName, setSenderName] = useState('Principal Accountant');
  const [senderEmail, setSenderEmail] = useState('office@datalazo.net');
  const [resendApiKey, setResendApiKey] = useState('');
  const [whatsappApiKey, setWhatsappApiKey] = useState('');
  const [twilioSid, setTwilioSid] = useState('');
  const [twilioToken, setTwilioToken] = useState('');
  const [googleCalUrl, setGoogleCalUrl] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [taxExtractorModel, setTaxExtractorModel] = useState('gpt-4o');

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch('/accounting/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setFirmName(data.firmName || '');
            setSenderName(data.senderName || '');
            setSenderEmail(data.senderEmail || '');
            setResendApiKey(data.resendApiKey || '');
            setWhatsappApiKey(data.whatsappApiKey || '');
            setTwilioSid(data.twilioSid || '');
            setTwilioToken(data.twilioToken || '');
            setGoogleCalUrl(data.googleCalUrl || '');
            setAiInstructions(data.aiInstructions || '');
            setTaxExtractorModel(data.taxExtractorModel || 'gpt-4o');
          }
        }
      } catch (err) {
        console.error('Failed to load system settings:', err);
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/accounting/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firmName,
          senderName,
          senderEmail,
          resendApiKey,
          whatsappApiKey,
          twilioSid,
          twilioToken,
          googleCalUrl,
          aiInstructions,
          taxExtractorModel,
        }),
      });

      if (res.ok) {
        setStatusMessage({ type: 'success', text: 'System settings saved successfully to droplet database!' });
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Failed to sync settings with droplets.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 font-sans">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#00f0ff] mb-4"></div>
        <p className="text-xs">Loading secure CPA system configuration...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 text-left font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            <span className="gradient-text">System Settings</span>
          </h1>
          <p className="text-slate-400 text-xs mt-1">Configure global integration parameters, outbound gateways, and real-time AI prompts.</p>
        </div>
        {statusMessage && (
          <div className={`px-4 py-2.5 rounded-xl text-xs font-bold border ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-950/40 border-emerald-500/20 text-emerald-400' 
              : 'bg-rose-950/40 border-rose-500/20 text-rose-400'
          }`}>
            {statusMessage.type === 'success' ? '✓' : '⚠️'} {statusMessage.text}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left Column: API Gateways */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">
          
          <div className="glass p-6 space-y-5 flex-1">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">🔑 Core API Gateways</h3>
            
            <div className="space-y-4 text-xs">
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Firm Brand Name</label>
                <input 
                  type="text" 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs"
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value)}
                  placeholder="Datalazo Ledger Services"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Tax Document OCR Model</label>
                <select 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs text-white"
                  value={taxExtractorModel}
                  onChange={(e) => setTaxExtractorModel(e.target.value)}
                >
                  <option value="gpt-4o">GPT-4o (High-Accuracy Vision / Default)</option>
                  <option value="gpt-4o-mini">GPT-4o-Mini (High-Speed / Low-Cost Vision)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Sender Email Domain</label>
                <input 
                  type="text" 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="office@datalazo.net"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Resend Email Gateway Key</label>
                <input 
                  type="password" 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs"
                  value={resendApiKey}
                  onChange={(e) => setResendApiKey(e.target.value)}
                  placeholder="re_••••••••••••••••••••••••"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">WhatsApp Business Key</label>
                <input 
                  type="password" 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs"
                  value={whatsappApiKey}
                  onChange={(e) => setWhatsappApiKey(e.target.value)}
                  placeholder="eaab••••••••••••••••••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Twilio Account SID</label>
                  <input 
                    type="text" 
                    className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs"
                    value={twilioSid}
                    onChange={(e) => setTwilioSid(e.target.value)}
                    placeholder="AC••••••••••••••••••••"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Twilio Token</label>
                  <input 
                    type="password" 
                    className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-slate-200 text-xs"
                    value={twilioToken}
                    onChange={(e) => setTwilioToken(e.target.value)}
                    placeholder="••••••••••••••••"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="glass p-4 flex flex-col justify-center">
            <button 
              type="submit" 
              disabled={saving}
              className="w-full py-3 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-[10px] font-bold uppercase rounded-lg hover:brightness-110 active:scale-[0.98] transition-all text-white"
            >
              {saving ? 'Syncing System Settings...' : 'Save Global Configuration'}
            </button>
          </div>
        </div>

        {/* Right Column: AI Custom Prompt Customizer */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="glass p-6 space-y-4 flex-1 flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                🤖 AI Concierge Training & Prompt Settings
              </h3>
              <span className="text-[9px] bg-[#00f0ff]/10 text-[#00f0ff] px-2 py-0.5 rounded-full font-bold uppercase">Dynamic Prompting</span>
            </div>
            
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Edit the text block below to dynamically re-train your chatbot. Customize packages, setup prices, S-Corp compliance instructions, or agency rules instantly without redeploying code.
            </p>

            <div className="flex-1 flex flex-col min-h-[350px]">
              <textarea 
                className="w-full flex-1 bg-[#050507] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-4 text-slate-200 text-xs leading-relaxed font-mono resize-none focus:ring-1 focus:ring-[#00f0ff]/20"
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder="Type dynamic AI Concierge prompt instructions, pricing tiers, and compliance knowledge base here..."
              />
            </div>
          </div>
        </div>

      </form>
    </div>
  );
}
