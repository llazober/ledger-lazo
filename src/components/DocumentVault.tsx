"use client";

import React, { useState, useTransition } from 'react';

interface Document {
  id: string;
  clientId?: string | null;
  name: string;
  url: string;
  fileType: string;
  fileSize: number;
  taxYear: number;
  category: string; // W2, 1099-NEC, Bank_Statement, Receipt, Tax_Notice
  status: string; // UPLOADED, OCR_PROCESSING, REVIEW_REQUIRED, VALIDATED
  extractedText?: string | null;
  aiSummary?: string | null;
  confidenceScore: number;
  validationErrors?: string | null;
  createdAt: string;
}

interface Client {
  id: string;
  name: string;
  companyName?: string | null;
  taxType: string;
}

interface DocumentVaultProps {
  initialDocs: Document[];
  clients: Client[];
}

const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function DocumentVault({ initialDocs, clients }: DocumentVaultProps) {
  const [docs, setDocs] = useState<Document[]>(initialDocs);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [activeDoc, setActiveDoc] = useState<Document | null>(initialDocs[0] || null);
  
  // RAG Chat States
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string }>>([
    { sender: 'ai', text: 'Hello! I am your RAG Document Assistant. Select a document on the left and ask me any questions about W2 forms, 1099 distributions, bank transactions, or flagged tax notices.' }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [isPending, startTransition] = useTransition();

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    // Optimistic UI updates
    setDocs(prev => prev.filter(d => d.id !== docId));
    if (activeDoc?.id === docId) {
      setActiveDoc(docs.find(d => d.id !== docId) || null);
    }

    startTransition(async () => {
      try {
        await fetch(`/accounting/api/crm/document?docId=${docId}`, {
          method: 'DELETE'
        });
      } catch (err) {
        console.error("Error deleting document:", err);
      }
    });
  };

  // Filter docs based on client selection
  const filteredDocs = selectedClientId 
    ? docs.filter(d => d.clientId === selectedClientId) 
    : docs;

  // Stats
  const totalDocs = filteredDocs.length;
  const processedDocs = filteredDocs.filter(d => d.status === 'VALIDATED').length;
  const processingDocs = filteredDocs.filter(d => d.status === 'OCR_PROCESSING').length;
  const reviewRequiredDocs = filteredDocs.filter(d => d.status === 'REVIEW_REQUIRED').length;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    
    files.forEach(async (file) => {
      const newDocId = 'doc_' + Math.random().toString(36).substr(2, 9);
      const name = file.name;
      const size = file.size;
      const extension = name.split('.').pop()?.toUpperCase() || 'PDF';

      let fileDataBase64: string | null = null;
      try {
        fileDataBase64 = await readFileAsBase64(file);
      } catch (err) {
        console.error("Error reading file binary:", err);
      }

      const tempDoc: Document = {
        id: newDocId,
        clientId: selectedClientId || null,
        name,
        url: '#',
        fileType: extension,
        fileSize: size,
        taxYear: 2026,
        category: 'UNCLASSIFIED',
        status: 'OCR_PROCESSING',
        confidenceScore: 0.0,
        createdAt: new Date().toISOString()
      };

      setDocs(prev => [tempDoc, ...prev]);
      setActiveDoc(tempDoc);

      // Simulate n8n/AI asynchronous OCR classification in 3 seconds
      setTimeout(async () => {
        let category = 'Receipt';
        let extractedText = 'Invoice: #89281\nTotal: $120.50\nVendor: AWS Services';
        let aiSummary = 'AWS Hosting services receipt dated May 2026. Subtotal: $120.50. Checked as deductible business expense.';
        let confidenceScore = 0.94;
        let validationErrors = null;

        if (name.toLowerCase().includes('w2') || name.toLowerCase().includes('w-2')) {
          category = 'W2';
          extractedText = 'Form W-2 Wage and Tax Statement 2025\nBox 1 Wages: $94,500.00\nBox 2 Federal Income Tax withheld: $14,200.00\nEmployer: Google Inc';
          aiSummary = 'W-2 Wage Statement from Google Inc for tax year 2025. Wages: $94,500.00, Federal tax withheld: $14,200.00.';
          confidenceScore = 0.98;
        } else if (name.toLowerCase().includes('1099')) {
          category = '1099-NEC';
          extractedText = 'Form 1099-NEC Nonemployee Compensation\nBox 1: $12,000.00\nPayer: Upwork Inc\nRecipient: Luis Lazo';
          aiSummary = '1099-NEC Nonemployee Compensation from Upwork Inc. Total gross payments: $12,000.00. Categorized as Schedule C freelance revenue.';
          confidenceScore = 0.97;
        } else if (name.toLowerCase().includes('bank') || name.toLowerCase().includes('statement')) {
          category = 'Bank_Statement';
          extractedText = 'Chase Business Checking Statement\nBeginning Balance: $25,000.00\nEnding Balance: $18,400.00\nFlagged Transactions: Transfer $5,000.00 to Personal savings';
          aiSummary = 'Chase checking statement. Ending Balance: $18,400.00. Note: Contains an unclassified personal distribution transfer of $5,000.';
          confidenceScore = 0.88;
          validationErrors = 'Flagged $5,000 personal savings transfer for accountant check.';
        }

        const finalStatus = validationErrors ? 'REVIEW_REQUIRED' : 'VALIDATED';

        setDocs(prev => prev.map(d => d.id === newDocId ? {
          ...d,
          category,
          status: finalStatus,
          extractedText,
          aiSummary,
          confidenceScore,
          validationErrors
        } : d));

        // Update active document details
        setActiveDoc(prev => prev?.id === newDocId ? {
          ...prev,
          category,
          status: finalStatus,
          extractedText,
          aiSummary,
          confidenceScore,
          validationErrors
        } : prev);

        // Optional server push
        try {
          await fetch('/accounting/api/crm/document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              fileSize: size,
              fileType: extension,
              category,
              status: finalStatus,
              extractedText,
              aiSummary,
              confidenceScore,
              validationErrors,
              fileData: fileDataBase64,
              clientId: selectedClientId || null
            })
          });
        } catch (err) {
          console.error("Error logging document to DB:", err);
        }
      }, 3000);
    });
  };

  // Mock RAG response logic
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = chatInput;
    setChatMessages(prev => [...prev, { sender: 'user', text: userMsg }]);
    setChatInput('');
    setIsChatLoading(true);

    setTimeout(() => {
      let response = "I've searched your private knowledge database. I could not locate any definitive filings matching that exact query. Please upload a relevant W-2 or W-9 form to index.";

      if (activeDoc) {
        const text = (activeDoc.extractedText || '').toLowerCase();
        const query = userMsg.toLowerCase();

        if (query.includes('wages') || query.includes('salary') || query.includes('w2') || query.includes('w-2')) {
          if (activeDoc.category === 'W2') {
            response = `Under W-2 Form for ${activeDoc.name}, Google Inc reported total gross wages of $94,500.00 (Box 1) and Federal income tax withheld of $14,200.00 (Box 2).`;
          } else {
            response = `I searched the currently selected document (${activeDoc.name}), but it doesn't appear to be a W-2 wage statement. Please select a W-2 file.`;
          }
        } else if (query.includes('summary') || query.includes('tldr') || query.includes('explain')) {
          response = activeDoc.aiSummary || `This document represents a ${activeDoc.category} file with a parsing confidence score of ${Math.round(activeDoc.confidenceScore * 100)}%. No anomalies found.`;
        } else if (query.includes('payer') || query.includes('compensation') || query.includes('1099')) {
          if (activeDoc.category === '1099-NEC') {
            response = `The 1099-NEC statement from Upwork Inc indicates Nonemployee compensation of $12,000.00 (Box 1) for the tax year ${activeDoc.taxYear}. This must be reported on Schedule C.`;
          } else {
            response = `The currently selected document is not a 1099. Select the 1099 file to retrieve payer details.`;
          }
        } else if (query.includes('flag') || query.includes('error') || query.includes('anomaly') || query.includes('warning')) {
          if (activeDoc.validationErrors) {
            response = `Warning found: The AI scanner flagged a discrepancy: "${activeDoc.validationErrors}". We recommend manual review before preparation.`;
          } else {
            response = `Good news! The AI OCR classification scanned this document with ${Math.round(activeDoc.confidenceScore * 100)}% confidence and found zero errors or anomalies.`;
          }
        } else {
          response = `Based on the RAG index of "${activeDoc.name}": The scanned content contains references to: "${activeDoc.extractedText?.substring(0, 100)}...". Let me know if you want me to calculate standard deductions or draft a client response letter!`;
        }
      } else {
        response = "Please select a document from the left list first so I can retrieve its index details.";
      }

      setChatMessages(prev => [...prev, { sender: 'ai', text: response }]);
      setIsChatLoading(false);
    }, 1200);
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header Info */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            <span className="gradient-text">Document Vault</span>
          </h1>
          <p className="text-slate-400 text-xs mt-1">Upload taxpayer forms, verify OCR text extractions, and query document RAG contexts in real-time.</p>
        </div>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass p-4 text-left">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Vault Files</span>
          <span className="text-xl font-black text-white mt-1 block">{totalDocs}</span>
        </div>
        <div className="glass p-4 text-left">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">OCR Validated</span>
          <span className="text-xl font-black text-emerald-400 mt-1 block">{processedDocs}</span>
        </div>
        <div className="glass p-4 text-left">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">In Queue</span>
          <span className="text-xl font-black text-cyan-400 mt-1 block">{processingDocs}</span>
        </div>
        <div className="glass p-4 text-left">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Needs CPA Review</span>
          <span className="text-xl font-black text-rose-400 mt-1 block">{reviewRequiredDocs}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Side: Upload & File list (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          {/* Drag & Drop Zone */}
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-3xl p-8 text-center transition-all duration-300 ${
              isDragging 
                ? 'border-[#00f0ff] bg-[#00f0ff]/5 shadow-[0_0_20px_rgba(0,240,255,0.08)]' 
                : 'border-white/10 bg-white/[0.01] hover:border-[#00f0ff]/30 hover:bg-white/[0.02]'
            }`}
          >
            <div className="flex flex-col items-center justify-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 shadow-lg">
                <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <h4 className="text-white font-bold text-sm">Drag and drop tax files here</h4>
                <p className="text-slate-400 text-[10px] mt-1">Supports PDF, PNG, or JPG files up to 25MB. Mock OCR triggers instantly.</p>
              </div>
            </div>
          </div>

          {/* Document list table */}
          <div className="glass overflow-hidden flex-1 flex flex-col">
            <div className="p-4 border-b border-white/5 bg-white/[0.01] flex justify-between items-center flex-wrap gap-3">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-300">File Directory</h3>
              
              {/* Client Filter Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Filter Client:</span>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="bg-[#0f0f12] border border-white/10 focus:border-[#00f0ff] focus:outline-none rounded-lg text-slate-300 text-xs px-2 py-1 font-semibold transition-all"
                >
                  <option value="">All Clients</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.taxType})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="divide-y divide-white/5 overflow-y-auto max-h-[350px]">
              {filteredDocs.map(doc => (
                <div 
                  key={doc.id}
                  onClick={() => setActiveDoc(doc)}
                  className={`p-4 flex justify-between items-center cursor-pointer transition-all hover:bg-white/[0.01] ${
                    activeDoc?.id === doc.id ? 'bg-[#00f0ff]/5 border-l-2 border-[#00f0ff]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden pr-2 text-left">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[10px] ${
                      doc.fileType === 'PDF' ? 'bg-red-500/10 text-red-400' : 'bg-cyan-500/10 text-cyan-400'
                    }`}>
                      {doc.fileType}
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-semibold text-white truncate">{doc.name}</div>
                      <div className="flex gap-2 items-center mt-1">
                        <span className="text-[9px] text-slate-500 font-medium">{(doc.fileSize / 1024).toFixed(1)} KB</span>
                        <span className="text-[8px] text-slate-600 font-black">•</span>
                        <span className="text-[9px] text-slate-400 font-semibold uppercase">{doc.category}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {doc.status === 'OCR_PROCESSING' ? (
                      <span className="text-[9px] text-cyan-400 font-bold bg-cyan-500/10 px-2 py-0.5 rounded animate-pulse">OCR SCANNING</span>
                    ) : doc.status === 'REVIEW_REQUIRED' ? (
                      <span className="text-[9px] text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/10">NEEDS REVIEW</span>
                    ) : (
                      <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">VALIDATED</span>
                    )}
                    
                    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <a 
                        href={`/accounting/api/crm/document/download?docId=${doc.id}&preview=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-all font-semibold"
                        title="Preview inline"
                      >
                        👁️
                      </a>
                      <a 
                        href={`/accounting/api/crm/document/download?docId=${doc.id}`}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-[#00f0ff]/5 hover:bg-[#00f0ff]/15 px-2 py-1 rounded transition-all font-semibold"
                        title="Download file"
                      >
                        📥
                      </a>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDoc(doc.id);
                      }}
                      className="text-[10px] text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 p-1.5 rounded transition-all font-bold"
                      title="Delete Document"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
              {filteredDocs.length === 0 && (
                <div className="p-8 text-center text-slate-600 text-xs">
                  No documents found for this client.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: OCR Inspection & RAG Chat (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          {/* Active File Inspector */}
          {activeDoc && (
            <div className="glass p-5 space-y-4 text-left">
              <div className="flex justify-between items-start">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">OCR Classifications</span>
                <span className="text-[10px] text-[#00f0ff] font-extrabold bg-[#00f0ff]/5 px-2 py-0.5 rounded">
                  Confidence: {Math.round(activeDoc.confidenceScore * 100)}%
                </span>
              </div>
              
              <h3 className="font-extrabold text-white text-base tracking-tight leading-snug">{activeDoc.name}</h3>
              
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="bg-[#0a0a0c] p-3 rounded-xl border border-white/5">
                  <span className="text-[8px] text-slate-500 font-bold block uppercase">Extracted Category</span>
                  <span className="text-xs text-white font-bold block mt-0.5 uppercase tracking-wider">{activeDoc.category}</span>
                </div>
                <div className="bg-[#0a0a0c] p-3 rounded-xl border border-white/5">
                  <span className="text-[8px] text-slate-500 font-bold block uppercase">Taxation Period</span>
                  <span className="text-xs text-white font-bold block mt-0.5">TY {activeDoc.taxYear}</span>
                </div>
              </div>

              {activeDoc.validationErrors && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/15 text-rose-400 rounded-xl text-[10px] leading-relaxed flex items-start gap-2">
                  <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <span className="font-bold uppercase tracking-wider block text-[9px] mb-0.5">Scanned Discrepancy Found:</span>
                    {activeDoc.validationErrors}
                  </div>
                </div>
              )}

              {/* Document Text / Preview Viewer */}
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">File Content Preview</span>
                  <a
                    href={`/accounting/api/crm/document/download?docId=${activeDoc.id}`}
                    className="text-[9px] text-cyan-400 hover:text-cyan-300 font-extrabold flex items-center gap-1 bg-cyan-900/20 px-2.5 py-1 rounded border border-cyan-500/20 transition-all hover:scale-105"
                  >
                    📥 Download Document
                  </a>
                </div>
                <div className="bg-[#f8f9fa] border border-slate-200 rounded-xl p-4 min-h-[140px] max-h-[200px] overflow-y-auto text-slate-800 font-mono text-[10px] leading-relaxed whitespace-pre-wrap shadow-inner relative select-text">
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[8px] font-sans font-bold select-none">
                    OCR TRANSCRIPT
                  </div>
                  {activeDoc.extractedText || "No text could be extracted from this document."}
                </div>
              </div>

              {activeDoc.aiSummary && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">AI Executive Brief</span>
                  <p className="text-slate-300 text-xs leading-relaxed bg-[#0a0a0c] p-3 rounded-xl border border-white/5 font-sans">
                    {activeDoc.aiSummary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Interactive RAG Chat Panel */}
          <div className="glass overflow-hidden flex flex-col min-h-[350px] max-h-[420px] text-left">
            <div className="p-4 border-b border-white/5 bg-white/[0.01] flex items-center justify-between">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#00f0ff] animate-pulse"></span>
                RAG Document Query Engine
              </h3>
            </div>
            
            {/* Messages Display */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 font-sans text-xs">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`p-3 rounded-2xl max-w-[85%] leading-relaxed ${
                    msg.sender === 'user' 
                      ? 'bg-gradient-to-tr from-[#00f0ff]/10 to-[#6366f1]/10 text-slate-200 border border-[#00f0ff]/20' 
                      : 'bg-white/5 text-slate-300 border border-white/5'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="p-3 rounded-2xl bg-white/5 text-slate-500 border border-white/5 flex items-center gap-1.5 animate-pulse">
                    <span>AI searching vector index...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-white/5 bg-[#0a0a0c] flex gap-2">
              <input
                type="text"
                className="flex-1 bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00f0ff] transition-all font-sans"
                placeholder={activeDoc ? `Ask about "${activeDoc.name}"...` : "Select a document first..."}
                value={chatInput}
                disabled={!activeDoc || isChatLoading}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <button
                type="submit"
                disabled={!activeDoc || isChatLoading || !chatInput.trim()}
                className="px-4 py-2 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-[10px] font-bold uppercase rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
              >
                Query
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
