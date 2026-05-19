"use client";

import React, { useState, useRef, useEffect } from 'react';

export default function ChatAgent() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { 
      role: 'assistant', 
      content: 'Hello! I am Lazo, your Datalazo Ledger AI Concierge. I can explain our CPA automation packages or answer general taxpayer questions in English & Spanish. How can I help you scale today?' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || input.trim();
    if (!text || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsLoading(true);

    try {
      const response = await fetch('/accounting/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      });

      const data = await response.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        throw new Error('No reply');
      }
    } catch {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I apologize, I encountered a connection issue. Once you establish your database setup and API tokens, I will be fully functional!" 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    { label: '📊 View Packages', text: 'Explain the 3 CPA Automation packages and setup prices.' },
    { label: '🇪🇸 ¿Soporte en Español?', text: '¿Puedes ayudarme en español?' },
    { label: '💸 QBI Deduction', text: 'Explain the Section 199A QBI deduction requirements.' }
  ];

  const formatMessage = (content: string) => {
    return content.split('\n').map((line, i) => {
      const formattedLine = line.split(/(\*\*.*?\*\*)/).map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j} className="text-[#00f0ff] font-bold">{part.slice(2, -2)}</strong>;
        }
        return part;
      });

      return (
        <div key={i} className={line.trim().startsWith('-') || line.trim().match(/^\d+\./) ? 'ml-2 mb-1 pl-2 border-l border-white/10' : 'mb-2'}>
          {formattedLine}
        </div>
      );
    });
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] font-sans text-left">
      {/* Chat Window */}
      {isOpen && (
        <div className="glass w-[350px] md:w-[400px] h-[550px] mb-4 flex flex-col shadow-[0_0_50px_rgba(0,240,255,0.15)] animate-in slide-in-from-bottom-4 duration-300 rounded-3xl border border-white/10 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-cyan-950/40 to-indigo-950/40">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(0,240,255,0.8)]" />
              <div>
                <span className="font-extrabold text-xs text-white uppercase tracking-wider block">Lazo Assistant</span>
                <span className="text-[9px] text-slate-500 block leading-none">Bilingual Firm Concierge</span>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)} 
              className="text-slate-400 hover:text-white p-1 hover:bg-white/5 rounded-full transition-all duration-200"
            >
              ✕
            </button>
          </div>
          
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user' 
                    ? 'bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white shadow-lg font-medium' 
                    : 'bg-[#0f1118]/80 text-slate-200 border border-white/5 shadow-inner'
                }`}>
                  {formatMessage(m.content)}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-[#0f1118]/80 p-3 rounded-2xl flex gap-1.5 border border-white/5">
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          {messages.length === 1 && (
            <div className="p-3 bg-black/10 border-t border-white/5 flex flex-wrap gap-2 justify-center">
              {quickPrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(p.text)}
                  className="px-2.5 py-1 bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/20 text-[10px] font-bold text-slate-300 hover:text-white rounded-full transition-all duration-200"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Footer Input */}
          <div className="p-4 border-t border-white/10 bg-[#06070a]/90">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Pregunta o escribe mensaje..."
                className="flex-1 bg-[#0f1118]/90 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 transition-all placeholder:text-slate-500"
              />
              <button 
                onClick={() => handleSend()}
                disabled={isLoading}
                className="bg-cyan-500 text-black p-2.5 rounded-xl hover:scale-105 transition-transform disabled:opacity-50 font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] shrink-0"
              >
                <svg className="w-4 h-4 text-black font-extrabold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,240,255,0.4)] ${
          isOpen ? 'bg-slate-900 rotate-90 text-white' : 'bg-gradient-to-tr from-cyan-400 to-indigo-500 text-black hover:scale-110'
        }`}
      >
        {isOpen ? (
          <span className="text-xl font-bold">✕</span>
        ) : (
          <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>
    </div>
  );
}
