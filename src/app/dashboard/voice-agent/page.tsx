import React from 'react';

export default function VoiceAgentPage() {
  const callLogs = [
    { id: '1', caller: 'Miami Plumbing LLC', duration: '2m 14s', outcome: 'Booked discovery call', time: '10 mins ago', notes: 'Luis Lazo selected for 1120S discovery' },
    { id: '2', caller: 'John Smith (Individual)', duration: '1m 45s', outcome: 'Sent W2 upload link', time: '1 hour ago', notes: 'Automated SMS sent with secure client link' },
    { id: '3', caller: 'Sarah Jenkins, DDS', duration: '3m 02s', outcome: 'Routed to Spanish team', time: '3 hours ago', notes: 'Escalated because caller requested tax planning' }
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 text-left">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          <span className="gradient-text">Voice Receptionist</span>
        </h1>
        <p className="text-slate-400 text-xs mt-1">Configure automated AI phone agents, examine real-time voice call transcripts, and track inbound lead routing logs.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Call Logs (2 cols on large screen) */}
        <div className="lg:col-span-2 glass p-6 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">📞 Recent Inbound AI Calls</h3>
          <div className="divide-y divide-white/5 font-sans">
            {callLogs.map(log => (
              <div key={log.id} className="py-3 flex justify-between items-start gap-4 text-xs first:pt-0 last:pb-0">
                <div>
                  <div className="font-bold text-white text-sm">{log.caller}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{log.time} • Duration: {log.duration}</div>
                  <p className="text-slate-400 mt-1 leading-normal">{log.notes}</p>
                </div>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase shrink-0 border border-emerald-500/10">
                  {log.outcome}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Voice Agent Setup (1 col) */}
        <div className="glass p-6 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">⚙️ Receptionist Prompt</h3>
          <p className="text-slate-300 text-xs leading-relaxed font-sans">
            Your VAPI / Twilio voice assistant answers incoming calls in &lt;100ms. Instruct the agent:
          </p>
          <div className="p-3 bg-[#0a0a0c] border border-white/5 rounded-xl font-mono text-[10px] leading-relaxed text-slate-400">
            "You are Lazo, the Spanish/English AI receptionist for Datalazo Ledger. Qualify the client's entity type (S-Corp, partnership, individual). Offer to book a Google Calendar discovery call..."
          </div>
          <div className="pt-2">
            <button className="w-full py-2 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-[10px] font-bold uppercase rounded-lg">
              Synchronize Voice Prompt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
