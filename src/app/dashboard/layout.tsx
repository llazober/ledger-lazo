"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const navItems = [
    { name: 'Dashboard CRM', path: '/dashboard', color: 'text-cyan-400 hover:bg-cyan-500/10' },
    { name: 'Document Vault (OCR)', path: '/dashboard/documents', color: 'text-indigo-400 hover:bg-indigo-500/10' },
    { name: 'RAG Tax Assistant', path: '/dashboard/tax-planning', color: 'text-purple-400 hover:bg-purple-500/10' },
    { name: 'Voice Receptionist', path: '/dashboard/voice-agent', color: 'text-emerald-400 hover:bg-emerald-500/10' },
    { name: 'Calendar & Deadlines', path: '/dashboard/appointments', color: 'text-rose-400 hover:bg-rose-500/10' },
    { name: 'System Settings', path: '/dashboard/settings', color: 'text-amber-400 hover:bg-amber-500/10' },
  ];

  return (
    <div className="flex h-screen bg-[#06070a] text-white overflow-hidden font-sans">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#06070a] border-b border-white/5 z-50 flex items-center justify-between px-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] flex items-center justify-center font-black text-white italic tracking-tighter">DL</div>
          <span className="font-black italic tracking-tighter uppercase text-xs">Datalazo Ledger</span>
        </Link>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-slate-400 hover:text-white"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16m-7 6h7"} />
          </svg>
        </button>
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative z-50 w-64 h-full border-r border-white/5 bg-[#06070a] flex flex-col p-6 transition-transform duration-300
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <Link href="/dashboard" className="hidden md:flex items-center gap-3 mb-10 mt-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] flex items-center justify-center font-black text-white italic tracking-tighter shadow-[0_0_20px_rgba(0,240,255,0.3)]">DL</div>
          <div>
            <span className="font-black tracking-tight text-sm uppercase block">Datalazo Ledger</span>
            <span className="text-[10px] text-slate-400 block tracking-wider font-semibold">CPA AUTOMATION HUB</span>
          </div>
        </Link>
        
        <nav className="flex-1 space-y-1 mt-16 md:mt-0">
          {navItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.name}
                href={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`block px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                  isActive 
                    ? 'bg-white/5 text-white border-l-2 border-[#00f0ff] pl-3' 
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.02]'
                }`}
              >
                <span className={isActive ? item.color.split(' ')[0] : ''}>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="pt-6 border-t border-white/5 flex flex-col gap-4">
          <div className="flex items-center gap-3 px-4">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] p-0.5">
              <div className="w-full h-full bg-[#06070a] rounded-full flex items-center justify-center text-xs font-bold text-cyan-400">LA</div>
            </div>
            <div className="text-sm overflow-hidden">
              <div className="font-semibold text-white tracking-tight">Luis Lazo, CPA</div>
              <div className="text-[10px] text-slate-500 truncate">luis@datalazo.net</div>
            </div>
          </div>
          <button 
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
            className="w-full px-4 py-2.5 bg-red-500/5 text-red-400 text-[10px] font-bold tracking-wider uppercase rounded-xl hover:bg-red-500/10 transition-all text-center border border-red-500/15"
          >
            Logout Security
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-white/[0.01] pt-16 md:pt-0">
        {children}
      </main>
    </div>
  );
}
