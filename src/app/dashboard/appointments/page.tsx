import React from 'react';

export default function AppointmentsPage() {
  const events = [
    { id: '1', title: 'Q2 Estimated Tax Payment Deadline', date: 'June 15, 2026', type: 'TAX_DEADLINE', status: 'CRITICAL' },
    { id: '2', title: 'Discovery Call: Miami Plumbing LLC', date: 'May 20, 2026 at 2:00 PM', type: 'APPOINTMENT', status: 'CONFIRMED' },
    { id: '3', title: 'Onboarding Review: Upwork Income Statement', date: 'May 21, 2026 at 10:30 AM', type: 'INTERNAL', status: 'PENDING' }
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 text-left">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          <span className="gradient-text">Calendar & Deadlines</span>
        </h1>
        <p className="text-slate-400 text-xs mt-1">Synchronize Google Calendars, manage client tax deadlines, and monitor the automated missing-document SMS/WhatsApp reminder queue.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Events List (2 cols) */}
        <div className="lg:col-span-2 glass p-6 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">📅 Scheduled Operations</h3>
          <div className="divide-y divide-white/5 font-sans">
            {events.map(event => (
              <div key={event.id} className="py-3.5 flex justify-between items-center gap-4 text-xs first:pt-0 last:pb-0">
                <div>
                  <div className="font-bold text-white text-sm">{event.title}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{event.date}</div>
                </div>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${
                  event.status === 'CRITICAL' 
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/10' 
                    : event.status === 'CONFIRMED' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' 
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/10'
                }`}>
                  {event.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Reminders Setup (1 col) */}
        <div className="glass p-6 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">⏰ Automated Reminders</h3>
          <p className="text-slate-300 text-xs leading-relaxed font-sans">
            Datalazo Ledger automatically triggers SMS and WhatsApp reminders for clients with `MISSING_DOCS` status:
          </p>
          <div className="p-3 bg-[#0a0a0c] border border-white/5 rounded-xl text-slate-400 text-[10px] leading-relaxed font-sans space-y-1">
            <span className="font-bold text-cyan-400">REMINDER CADENCE:</span>
            <p>• Day 1: Instant portal upload request</p>
            <p>• Day 3: WhatsApp follow-up via Twilio</p>
            <p>• Day 7: Direct SMS with secure file upload link</p>
          </div>
        </div>
      </div>
    </div>
  );
}
