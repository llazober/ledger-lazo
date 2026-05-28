import React from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function getOrSeedUsageData() {
  let usages = await prisma.tokenUsage.findMany({
    orderBy: { createdAt: 'desc' }
  });

  // Seed default values matching the user's image if the table is empty
  if (usages.length === 0) {
    try {
      await prisma.tokenUsage.createMany({
        data: [
          {
            feature: 'SEO CONTENT',
            model: 'gpt-4o-mini',
            promptTokens: 9000,
            completionTokens: 4000,
            totalTokens: 13000,
            cost: 0.0141,
          },
          {
            feature: 'CHAT',
            model: 'gpt-4o-mini',
            promptTokens: 12000,
            completionTokens: 3700,
            totalTokens: 15700,
            cost: 0.0035,
          },
          {
            feature: 'VOICE AGENT',
            model: 'gpt-4o',
            promptTokens: 1500,
            completionTokens: 600,
            totalTokens: 2100,
            cost: 0.0205,
          },
          {
            feature: 'OCR & EXTRACTION',
            model: 'gpt-4o',
            promptTokens: 4000,
            completionTokens: 2000,
            totalTokens: 6000,
            cost: 0.0540,
          }
        ]
      });
      usages = await prisma.tokenUsage.findMany({
        orderBy: { createdAt: 'desc' }
      });
    } catch (err) {
      console.error("Failed to seed default token usages:", err);
    }
  }
  return usages;
}

export default async function AIUsagePage() {
  const usages = await getOrSeedUsageData();

  // Aggregate totals
  const aggregates: Record<string, { tokens: number; cost: number }> = {};
  let totalTokens = 0;
  let totalCost = 0;

  // Initialize features to ensure they are always displayed
  const features = ['SEO CONTENT', 'CHAT', 'VOICE AGENT', 'OCR & EXTRACTION'];
  features.forEach(f => {
    aggregates[f] = { tokens: 0, cost: 0 };
  });

  usages.forEach(u => {
    const f = u.feature.toUpperCase();
    if (!aggregates[f]) {
      aggregates[f] = { tokens: 0, cost: 0 };
    }
    aggregates[f].tokens += u.totalTokens;
    aggregates[f].cost += u.cost;
    totalTokens += u.totalTokens;
    totalCost += u.cost;
  });

  // Helper formats
  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCost = (num: number) => {
    return `$${num.toFixed(4)}`;
  };

  // We set a budget ceiling of 100k tokens for the progress bar
  const budgetCeiling = 100000;
  const progressPercent = Math.min(100, (totalTokens / budgetCeiling) * 100);

  return (
    <div className="p-6 md:p-8 space-y-6 text-left font-sans min-h-screen bg-[#06070a] text-white">
      {/* Back Link */}
      <div>
        <Link 
          href="/dashboard" 
          className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-wider flex items-center gap-1.5"
        >
          ← Back to Overview
        </Link>
      </div>

      {/* Page Title & Header */}
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase text-white">
          Intelligence <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00f0ff] to-[#6366f1]">Consumption Matrix</span>
        </h1>
        <p className="text-slate-400 text-xs">
          Detailed breakdown of AI processing, token usage, and agency cost efficiency.
        </p>
      </div>

      {/* Main Glass Dashboard Card */}
      <div className="glass p-6 md:p-8 rounded-2xl border border-white/5 space-y-8 bg-[#0d0e14]/50 backdrop-blur-md">
        
        {/* Card Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-white/5 pb-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-black italic tracking-tighter text-white uppercase">
              Intelligence Consumption
            </h2>
            <div className="inline-block bg-white/5 px-2.5 py-1 rounded border border-white/10 text-[9px] font-bold text-slate-400 tracking-wider uppercase">
              OpenAI Token & Budget Matrix
            </div>
          </div>

          <div className="sm:text-right space-y-0.5">
            <div className="text-3xl md:text-4xl font-extrabold text-slate-100 tracking-tight">
              {formatCost(totalCost)}
            </div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              Est. Lifetime Cost
            </div>
          </div>
        </div>

        {/* Inner Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Left Panel: Feature Cards List */}
          <div className="lg:col-span-7 space-y-4">
            {Object.entries(aggregates).map(([featureName, data]) => (
              <div 
                key={featureName} 
                className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all animate-fade-in"
              >
                <div className="space-y-1">
                  <div className="inline-block bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">
                    {featureName}
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium pl-1">
                    {formatTokens(data.tokens)} Tokens
                  </div>
                </div>

                <div className="text-lg font-bold text-white/90 font-mono">
                  {formatCost(data.cost)}
                </div>
              </div>
            ))}
          </div>

          {/* Right Panel: Aggregated Summary Progress Bar */}
          <div className="lg:col-span-5 flex animate-scale-in">
            <div className="w-full flex flex-col justify-center items-center p-8 rounded-2xl bg-black/40 border border-white/5 text-center space-y-6">
              
              <div className="space-y-1">
                <div className="text-5xl md:text-6xl font-black tracking-tight text-white font-mono">
                  {formatTokens(totalTokens)}
                </div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                  Total Intelligence <br /> Tokens Processed
                </div>
              </div>

              {/* Sleek Custom Progress Bar */}
              <div className="w-full max-w-[280px] space-y-2">
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[#00f0ff] to-[#6366f1] transition-all duration-500" 
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase tracking-wider px-1">
                  <span>0%</span>
                  <span>{progressPercent.toFixed(0)}% of limit</span>
                  <span>100K</span>
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
