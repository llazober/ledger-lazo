import React from 'react';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import ReviewForm from './ReviewForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ReviewPage({ searchParams }: PageProps) {
  const { id } = await searchParams;

  if (!id) {
    redirect('/dashboard/documents');
  }

  // Fetch document with client and taxFormData relation
  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      client: {
        include: {
          user: true
        }
      },
      taxFormData: true
    }
  });

  if (!document) {
    return (
      <div className="flex flex-col items-center justify-center p-6 space-y-4 bg-transparent">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">Document Not Found</h1>
        <p className="text-slate-400 text-xs max-w-sm mx-auto leading-relaxed">
          The requested document ID `{id}` does not exist or has been deleted from the system.
        </p>
        <a
          href="/dashboard/documents"
          className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-lg text-xs font-semibold uppercase tracking-wider transition-all"
        >
          Back to Vault
        </a>
      </div>
    );
  }

  // Serialize dates and non-serializable fields
  const serializedDoc = {
    id: document.id,
    name: document.name,
    url: document.url,
    fileType: document.fileType,
    fileSize: document.fileSize,
    taxYear: document.taxYear,
    category: document.category,
    status: document.status,
    extractedText: document.extractedText || '',
    aiSummary: document.aiSummary || '',
    confidenceScore: document.confidenceScore,
    validationErrors: document.validationErrors || null,
    fileData: document.fileData || null,
    humanVerified: document.humanVerified || false,
    clientName: document.client?.user?.name || 'Unknown Client',
    taxFormData: document.taxFormData ? {
      id: document.taxFormData.id,
      formType: document.taxFormData.formType,
      boxes: document.taxFormData.boxes || {}
    } : null,
    createdAt: document.createdAt.toISOString()
  };

  return (
    <div className="bg-[#090e18] text-slate-100 p-6 lg:p-8 min-h-screen border-l border-white/5">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Back Link and Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 font-medium">
              <a href="/dashboard/documents" className="flex items-center gap-1">
                <span>&larr;</span> Back to Document Vault
              </a>
            </div>
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              Review & Verify Document
              {serializedDoc.humanVerified && (
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Human Verified
                </span>
              )}
            </h1>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Client Profile</span>
            <span className="text-xs text-white font-bold block">{serializedDoc.clientName}</span>
          </div>
        </div>

        <ReviewForm initialDoc={serializedDoc} />
      </div>
    </div>
  );
}
