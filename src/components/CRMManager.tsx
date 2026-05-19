"use client";

import React, { useState, useTransition } from 'react';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

interface User {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
}

interface Client {
  id: string;
  userId: string;
  user: User;
  companyName?: string | null;
  taxType: string;
  taxYear: number;
  status: string; // ONBOARDING, MISSING_DOCS, IN_PREPARATION, REVIEW, COMPLETED
  createdAt: string;
}

interface Lead {
  id: string;
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  source: string;
  status: string; // NEW, CONTACTED, WON, LOST
  notes?: string | null;
  aiDossier?: string | null;
  createdAt: string;
}

async function triggerMergeDocuments(docIds: string[], docNames: string[], outputName: string = 'merged.pdf') {
  try {
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < docIds.length; i++) {
      const docId = docIds[i];
      const docName = docNames[i] || 'document.pdf';
      const extension = docName.split('.').pop()?.toLowerCase();

      const url = `/accounting/api/crm/document/download?docId=${docId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch document ${docId}`);
      const arrayBuffer = await response.arrayBuffer();

      if (extension === 'pdf') {
        const srcPdf = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } else if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') {
        const page = mergedPdf.addPage();
        const { width, height } = page.getSize();
        
        let img;
        if (extension === 'png') {
          img = await mergedPdf.embedPng(arrayBuffer);
        } else {
          img = await mergedPdf.embedJpg(arrayBuffer);
        }

        const imgDims = img.scaleToFit(width - 40, height - 40);
        page.drawImage(img, {
          x: (width - imgDims.width) / 2,
          y: (height - imgDims.height) / 2,
          width: imgDims.width,
          height: imgDims.height,
        });
      } else {
        console.warn(`Unsupported file format for merging: ${extension}`);
      }
    }

    const mergedPdfBytes = await mergedPdf.save();
    const mergedBlob = new Blob([mergedPdfBytes as any], { type: 'application/pdf' });

    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: outputName,
          types: [{
            description: 'PDF Document',
            accept: {
              'application/pdf': ['.pdf']
            }
          }]
        });

        const writable = await handle.createWritable();
        await writable.write(mergedBlob);
        await writable.close();
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return;
        }
        console.warn("showSaveFilePicker failed or was aborted. Falling back to standard download.", err);
      }
    }

    const url = URL.createObjectURL(mergedBlob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', outputName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Error merging files:", err);
    alert("Error merging files. Make sure they are valid PDF or image files.");
  }
}

async function triggerFolderDownloadAsZip(docIds: string[], docNames: string[], archiveName: string = 'documents.zip') {
  const zip = new JSZip();

  const fetchPromises = docIds.map(async (docId, idx) => {
    try {
      const url = `/accounting/api/crm/document/download?docId=${docId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch document ${docId}`);
      const blob = await response.blob();
      
      const fileName = docNames[idx] || `document_${idx + 1}.pdf`;
      zip.file(fileName, blob);
    } catch (err) {
      console.error(`Error adding file ${docId} to ZIP:`, err);
    }
  });

  await Promise.all(fetchPromises);

  const zipBlob = await zip.generateAsync({ type: 'blob' });

  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: archiveName,
        types: [{
          description: 'ZIP Archive',
          accept: {
            'application/zip': ['.zip']
          }
        }]
      });

      const writable = await handle.createWritable();
      await writable.write(zipBlob);
      await writable.close();
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return;
      }
      console.warn("showSaveFilePicker failed or was aborted. Falling back to standard download.", err);
    }
  }

  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', archiveName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function triggerFileDownloadWithSavePicker(docId: string, suggestedName: string) {
  const url = `/accounting/api/crm/document/download?docId=${docId}`;
  
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();

      const extension = suggestedName.split('.').pop()?.toLowerCase() || 'pdf';
      let mimeType = 'application/octet-stream';
      if (extension === 'pdf') mimeType = 'application/pdf';
      else if (extension === 'jpg' || extension === 'jpeg') mimeType = 'image/jpeg';
      else if (extension === 'png') mimeType = 'image/png';

      const handle = await (window as any).showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{
          description: `${extension.toUpperCase()} File`,
          accept: {
            [mimeType]: [`.${extension}`]
          }
        }]
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return;
      }
      console.warn("showSaveFilePicker failed or was aborted. Falling back to standard download.", err);
    }
  }

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', suggestedName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface CRMManagerProps {
  initialLeads: Lead[];
  initialClients: Client[];
}

export default function CRMManager({ initialLeads, initialClients }: CRMManagerProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'leads'>('pipeline');
  
  // Modals and Details State
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [noteText, setNoteText] = useState('');
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Drag and Drop States
  const [draggedClientId, setDraggedClientId] = useState<string | null>(null);
  const [activeDragCol, setActiveDragCol] = useState<string | null>(null);
  
  // Client Tax Console Modal States
  const [selectedConsoleClient, setSelectedConsoleClient] = useState<Client | null>(null);
  const [consoleDocs, setConsoleDocs] = useState<any[]>([]);
  const [selectedConsoleDocs, setSelectedConsoleDocs] = useState<string[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleOpenConsole = async (client: Client) => {
    setSelectedConsoleClient(client);
    setIsLoadingDocs(true);
    setConsoleDocs([]);
    setSelectedConsoleDocs([]);
    try {
      const res = await fetch(`/accounting/api/crm/client/documents?clientId=${client.id}`);
      const data = await res.json();
      if (data.success) {
        setConsoleDocs(data.documents);
      }
    } catch (err) {
      console.error("Error fetching client documents:", err);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const handleToggleDocSelection = (docId: string) => {
    setSelectedConsoleDocs(prev => 
      prev.includes(docId) 
        ? prev.filter(id => id !== docId) 
        : [...prev, docId]
    );
  };

  const handleDownloadSelected = async () => {
    const validDocs = selectedConsoleDocs.filter(docId => {
      const doc = consoleDocs.find(d => d.id === docId);
      const isPdf = doc?.name.toLowerCase().endsWith('.pdf') || doc?.fileType.toUpperCase() === 'PDF';
      return isPdf;
    });

    if (validDocs.length === 0) {
      alert("No PDF files selected for download. Non-PDF files are excluded from batch operations.");
      return;
    }

    if (validDocs.length < selectedConsoleDocs.length) {
      alert(`Skipping ${selectedConsoleDocs.length - validDocs.length} non-PDF document(s) from the batch download.`);
    }

    const docNames = validDocs.map(docId => {
      const doc = consoleDocs.find(d => d.id === docId);
      return doc ? doc.name : 'document.pdf';
    });
    const clientName = selectedConsoleClient ? `${selectedConsoleClient.user.name} Documents.zip` : 'documents.zip';
    await triggerFolderDownloadAsZip(validDocs, docNames, clientName);
  };

  const handleMergeSelected = async () => {
    const validDocs = selectedConsoleDocs.filter(docId => {
      const doc = consoleDocs.find(d => d.id === docId);
      const isPdf = doc?.name.toLowerCase().endsWith('.pdf') || doc?.fileType.toUpperCase() === 'PDF';
      return isPdf;
    });

    if (validDocs.length === 0) {
      alert("No PDF files selected for merging. Non-PDF files are excluded from batch operations.");
      return;
    }

    if (validDocs.length < selectedConsoleDocs.length) {
      alert(`Skipping ${selectedConsoleDocs.length - validDocs.length} non-PDF document(s) from the merge.`);
    }

    const docNames = validDocs.map(docId => {
      const doc = consoleDocs.find(d => d.id === docId);
      return doc ? doc.name : 'document.pdf';
    });
    const clientName = selectedConsoleClient ? `${selectedConsoleClient.user.name} Merged.pdf` : 'merged.pdf';
    await triggerMergeDocuments(validDocs, docNames, clientName);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, clientId: string) => {
    setDraggedClientId(clientId);
    e.dataTransfer.setData('text/plain', clientId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnterCol = (e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    setActiveDragCol(colKey);
  };

  const handleDragLeaveCol = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropColumn = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setActiveDragCol(null);
    const clientId = draggedClientId || e.dataTransfer.getData('text/plain');
    if (!clientId) return;

    const client = clients.find(c => c.id === clientId);
    if (client && client.status !== targetStatus) {
      handleUpdateClientStatus(clientId, targetStatus);
    }
    setDraggedClientId(null);
  };

  const handleCardDrop = (e: React.DragEvent, targetClientId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragCol(null);
    const draggedId = draggedClientId || e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetClientId) return;

    const draggedClient = clients.find(c => c.id === draggedId);
    const targetClient = clients.find(c => c.id === targetClientId);
    if (!draggedClient || !targetClient) return;

    const newStatus = targetClient.status;
    const isStatusChanged = draggedClient.status !== newStatus;

    let updatedClients = [...clients];
    const draggedIdx = updatedClients.findIndex(c => c.id === draggedId);
    if (draggedIdx !== -1) {
      const [removed] = updatedClients.splice(draggedIdx, 1);
      removed.status = newStatus;
      const targetIdx = updatedClients.findIndex(c => c.id === targetClientId);
      updatedClients.splice(targetIdx, 0, removed);
      setClients(updatedClients);
    }

    if (isStatusChanged) {
      startTransition(async () => {
        try {
          await fetch('/accounting/api/crm/client', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: draggedId, status: newStatus }),
          });
        } catch (err) {
          console.error("Error updating client status via drag:", err);
        }
      });
    }

    setDraggedClientId(null);
  };

  const handleUploadTaxReturn = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConsoleClient) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('clientId', selectedConsoleClient.id);
    formData.append('file', file);

    try {
      const res = await fetch('/accounting/api/crm/client/upload-return', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert("Completed tax return uploaded successfully! Client status updated to 'In Review'.");
        
        // Update client status in local state
        setClients(prev => prev.map(c => c.id === selectedConsoleClient.id ? { ...c, status: 'REVIEW' } : c));
        
        // Refresh console documents list
        const refreshedRes = await fetch(`/accounting/api/crm/client/documents?clientId=${selectedConsoleClient.id}`);
        const refreshedData = await refreshedRes.json();
        if (refreshedData.success) {
          setConsoleDocs(refreshedData.documents);
        }
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (err: any) {
      alert("Error uploading tax return: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };
  
  // Form State for Mock Lead creation
  const [newLeadForm, setNewLeadForm] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    source: 'WEBSITE',
    notes: ''
  });

  const [isPending, startTransition] = useTransition();

  // Stats Calculations
  const totalLeads = leads.length;
  const wonLeads = leads.filter(l => l.status === 'WON').length;
  const winRate = totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0;
  const activeClientsCount = clients.length;
  const missingDocsCount = clients.filter(c => c.status === 'MISSING_DOCS').length;

  // Pipeline columns definitions
  const columns = [
    { key: 'ONBOARDING', label: 'Onboarding', color: 'border-l-cyan-400 bg-cyan-500/5' },
    { key: 'MISSING_DOCS', label: 'Missing Docs', color: 'border-l-rose-400 bg-rose-500/5' },
    { key: 'IN_PREPARATION', label: 'In Preparation', color: 'border-l-indigo-400 bg-indigo-500/5' },
    { key: 'REVIEW', label: 'In Review', color: 'border-l-purple-400 bg-purple-500/5' },
    { key: 'COMPLETED', label: 'Completed', color: 'border-l-emerald-400 bg-emerald-500/5' },
  ];

  // Actions handlers
  const handleUpdateLeadStatus = async (leadId: string, newStatus: string) => {
    // Optimistic UI updates
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    
    startTransition(async () => {
      try {
        const response = await fetch('/accounting/api/crm/lead', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId, status: newStatus }),
        });
        
        if (response.ok) {
          const data = await response.json();
          // If status became WON, refresh clients
          if (newStatus === 'WON' && data.newClient) {
            setClients(prev => [data.newClient, ...prev]);
          }
        }
      } catch (err) {
        console.error("Error updating lead status:", err);
      }
    });
  };

  const handleUpdateClientStatus = async (clientId: string, newStatus: string) => {
    // Optimistic UI update
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, status: newStatus } : c));
    
    startTransition(async () => {
      try {
        await fetch('/accounting/api/crm/client', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, status: newStatus }),
        });
      } catch (err) {
        console.error("Error updating client status:", err);
      }
    });
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!confirm('Are you sure you want to delete this client profile and their user account?')) return;
    
    setClients(prev => prev.filter(c => c.id !== clientId));
    
    startTransition(async () => {
      try {
        await fetch(`/accounting/api/crm/client?clientId=${clientId}`, {
          method: 'DELETE'
        });
      } catch (err) {
        console.error("Error deleting client:", err);
      }
    });
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    
    setLeads(prev => prev.filter(l => l.id !== leadId));
    
    startTransition(async () => {
      try {
        await fetch(`/accounting/api/crm/lead?leadId=${leadId}`, {
          method: 'DELETE'
        });
      } catch (err) {
        console.error("Error deleting lead:", err);
      }
    });
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    
    setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, notes: noteText } : l));
    setIsNoteModalOpen(false);
    
    startTransition(async () => {
      try {
        await fetch('/accounting/api/crm/lead/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: selectedLead.id, notes: noteText }),
        });
      } catch (err) {
        console.error("Error saving lead notes:", err);
      }
    });
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreateModalOpen(false);

    startTransition(async () => {
      try {
        const response = await fetch('/accounting/api/crm/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newLeadForm),
        });
        if (response.ok) {
          const data = await response.json();
          setLeads(prev => [data.lead, ...prev]);
          setNewLeadForm({ name: '', email: '', company: '', phone: '', source: 'WEBSITE', notes: '' });
        }
      } catch (err) {
        console.error("Error creating lead:", err);
      }
    });
  };

  const openNoteModal = (lead: Lead) => {
    setSelectedLead(lead);
    setNoteText(lead.notes || '');
    setIsNoteModalOpen(true);
  };

  return (
    <div className="space-y-8 p-6 md:p-8">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass p-6 flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Active CPA Clients</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-extrabold tracking-tight text-white">{activeClientsCount}</span>
            <span className="text-xs text-emerald-400 font-semibold">↑ Stable</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-2">Fulfillment operations</span>
        </div>

        <div className="glass p-6 flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Missing Documents</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className={`text-3xl font-extrabold tracking-tight ${missingDocsCount > 0 ? 'text-rose-400' : 'text-white'}`}>{missingDocsCount}</span>
            <span className="text-xs text-slate-400 font-medium">Pending Client Upload</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-2">Auto-reminders scheduled</span>
        </div>

        <div className="glass p-6 flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Total Scraped/Web Leads</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-extrabold tracking-tight text-white">{totalLeads}</span>
            <span className="text-xs text-cyan-400 font-semibold">100% Scraped</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-2">Apify Google Maps Scraper</span>
        </div>

        <div className="glass p-6 flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Acquisition Win Rate</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-extrabold tracking-tight text-[#00f0ff]">{winRate}%</span>
            <span className="text-xs text-[#6366f1] font-semibold">Target: 25%</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-2">Conversion to active billing</span>
        </div>
      </div>

      {/* Navigation Headers */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
        <div className="flex gap-4">
          <button 
            onClick={() => setActiveTab('pipeline')}
            className={`px-4 py-2 text-sm font-bold rounded-xl transition-all duration-200 ${
              activeTab === 'pipeline' 
                ? 'bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/20' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            📂 Active Client Pipeline
          </button>
          <button 
            onClick={() => setActiveTab('leads')}
            className={`px-4 py-2 text-sm font-bold rounded-xl transition-all duration-200 ${
              activeTab === 'leads' 
                ? 'bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/20' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🎯 Scraped / Web Leads ({leads.filter(l => l.status !== 'WON').length})
          </button>
        </div>
        
        <div className="flex gap-2 w-full sm:w-auto justify-end">
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-xs font-bold uppercase rounded-xl transition-all duration-200 hover:brightness-110 shadow-[0_0_15px_rgba(0,240,255,0.2)]"
          >
            + Create Mock Lead
          </button>
        </div>
      </div>

      {/* Active Pipeline Board */}
      {activeTab === 'pipeline' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 overflow-x-auto min-h-[500px] pb-6">
          {columns.map(col => {
            const colClients = clients.filter(c => c.status === col.key);
            return (
              <div 
                key={col.key} 
                className={`flex flex-col min-w-[240px] space-y-4 rounded-2xl p-2 transition-all duration-200 ${
                  activeDragCol === col.key 
                    ? 'bg-[#00f0ff]/5 ring-2 ring-[#00f0ff]/20' 
                    : 'bg-transparent'
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnterCol(e, col.key)}
                onDragLeave={handleDragLeaveCol}
                onDrop={(e) => handleDropColumn(e, col.key)}
              >
                {/* Column Header */}
                <div className={`p-4 border-l-2 rounded-xl flex justify-between items-center bg-white/[0.01] ${col.color} border-white/5`}>
                  <span className="font-bold text-xs tracking-wider uppercase text-slate-300">{col.label}</span>
                  <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full font-bold">{colClients.length}</span>
                </div>
                
                {/* Card Container */}
                <div className="flex-1 space-y-3 p-1">
                  {colClients.map(client => (
                    <div 
                      key={client.id} 
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, client.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleCardDrop(e, client.id)}
                      className="glass p-4 space-y-3 glass-card-hover text-left flex flex-col justify-between cursor-grab active:cursor-grabbing transition-all duration-150 hover:scale-[1.02]"
                    >
                      <div className="cursor-pointer group/card" onClick={() => handleOpenConsole(client)}>
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-xs bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-bold uppercase">{client.taxType}</span>
                          <span className="text-[10px] text-slate-500 font-semibold">TY {client.taxYear}</span>
                        </div>
                        <h4 className="font-bold text-white mt-2 leading-snug group-hover/card:text-[#00f0ff] transition-all flex items-center gap-1">
                          {client.user.name} <span className="opacity-0 group-hover/card:opacity-100 text-[10px]">⚙️</span>
                        </h4>
                        <p className="text-[10px] text-slate-400 font-medium truncate mt-1">{client.companyName || 'Individual Taxpayer'}</p>
                        <span className="text-[9px] text-[#00f0ff] font-bold block mt-2.5 bg-[#00f0ff]/5 border border-[#00f0ff]/10 rounded px-2 py-0.5 w-max hover:bg-[#00f0ff]/10 transition-all">
                          📂 Tax Console
                        </span>
                      </div>

                      <div className="pt-3 border-t border-white/5 flex flex-col gap-2 mt-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-slate-500 block font-bold">MOVE STAGE:</span>
                          <button
                            onClick={() => handleDeleteClient(client.id)}
                            className="text-[9px] text-rose-400 hover:text-rose-300 font-semibold px-1 py-0.5 rounded transition-all"
                            title="Delete Client"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {columns.filter(c => c.key !== col.key).map(c => (
                            <button
                              key={c.key}
                              onClick={() => handleUpdateClientStatus(client.id, c.key)}
                              className="text-[9px] bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white px-1.5 py-1 rounded transition-all truncate text-center font-medium"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {colClients.length === 0 && (
                    <div className="border border-dashed border-white/5 rounded-2xl h-36 flex items-center justify-center text-slate-600 text-xs">
                      No clients in this stage
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Leads CRM Table View */}
      {activeTab === 'leads' && (
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.01]">
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-400">Lead Info</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-400">Company & category</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-400">Source</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {leads.filter(l => l.status !== 'WON').map(lead => (
                  <tr key={lead.id} className="hover:bg-white/[0.01] transition-all">
                    <td className="p-4">
                      <div className="font-bold text-white text-sm">{lead.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{lead.email}</div>
                      {lead.phone && <div className="text-[10px] text-slate-500 mt-0.5">{lead.phone}</div>}
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-semibold text-slate-200">{lead.company || 'Individual'}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Local CPA Scraped Prospect</div>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        lead.source === 'APIFY' 
                          ? 'bg-emerald-500/10 text-emerald-400' 
                          : 'bg-indigo-500/10 text-indigo-400'
                      }`}>
                        {lead.source}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-black ${
                        lead.status === 'NEW' 
                          ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' 
                          : lead.status === 'CONTACTED' 
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button 
                        onClick={() => openNoteModal(lead)}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 text-xs font-semibold rounded-lg transition-all"
                      >
                        📝 Meeting Notes
                      </button>
                      
                      {lead.status !== 'CONTACTED' && (
                        <button 
                          onClick={() => handleUpdateLeadStatus(lead.id, 'CONTACTED')}
                          className="px-3 py-1.5 bg-[#6366f1]/10 hover:bg-[#6366f1]/20 border border-[#6366f1]/20 text-[#6366f1] text-xs font-semibold rounded-lg transition-all"
                        >
                          Contacted
                        </button>
                      )}
                      
                      <button 
                        onClick={() => handleUpdateLeadStatus(lead.id, 'WON')}
                        className="px-3 py-1.5 bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 border border-[#00f0ff]/20 text-[#00f0ff] text-xs font-bold rounded-lg transition-all"
                      >
                        🏆 WON
                      </button>

                      <button 
                        onClick={() => handleDeleteLead(lead.id)}
                        className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-bold rounded-lg transition-all"
                        title="Delete Lead"
                      >
                        🗑️ Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {leads.filter(l => l.status !== 'WON').length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-600 text-sm">
                      No active leads. Use "Create Mock Lead" to add test prospects!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Discovery Call Notes Modal */}
      {isNoteModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass w-full max-w-lg p-6 space-y-4 border border-[#00f0ff]/20 relative shadow-[0_0_50px_rgba(0,240,255,0.1)]">
            <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              📝 Discovery Notes: <span className="text-[#00f0ff]">{selectedLead.name}</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Use these qualitative notes to document discovery answers, outstanding IRS notices, corporate structures, tax years, or missing filings. These are saved permanently.
            </p>
            <textarea
              className="w-full h-44 bg-[#0a0a0c] border border-white/10 rounded-xl p-4 text-slate-200 text-sm focus:outline-none focus:border-[#00f0ff] transition-all font-sans"
              placeholder="e.g. Client needs 1120S for 2025 and 2026. Has an outstanding IRS penalty letter of $4,500. Subcontractors list W9s missing..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setIsNoteModalOpen(false)}
                className="px-4 py-2 text-slate-400 hover:text-white text-xs font-bold uppercase rounded-lg"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveNotes}
                className="px-4 py-2 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-xs font-bold uppercase rounded-lg shadow-[0_0_10px_rgba(0,240,255,0.2)]"
              >
                Save Qualitative Notes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Mock Lead Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass w-full max-w-md p-6 space-y-4 border border-[#00f0ff]/20 relative shadow-[0_0_50px_rgba(0,240,255,0.1)]">
            <h3 className="text-xl font-bold tracking-tight text-white">Create Mock CRM Lead</h3>
            <p className="text-xs text-slate-400">
              Manually add a local prospect to simulate intake channels, OCR pipelines, and client portal conversions.
            </p>
            
            <form onSubmit={handleCreateLead} className="space-y-3.5">
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Full Name</label>
                <input 
                  type="text" 
                  required
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-sm text-slate-200 transition-all"
                  value={newLeadForm.name}
                  onChange={(e) => setNewLeadForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Email Address</label>
                  <input 
                    type="email" 
                    required
                    className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-xs text-slate-200 transition-all"
                    value={newLeadForm.email}
                    onChange={(e) => setNewLeadForm(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Phone Number</label>
                  <input 
                    type="text" 
                    className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-xs text-slate-200 transition-all"
                    value={newLeadForm.phone}
                    onChange={(e) => setNewLeadForm(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Company Name</label>
                <input 
                  type="text" 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-sm text-slate-200 transition-all"
                  value={newLeadForm.company}
                  onChange={(e) => setNewLeadForm(prev => ({ ...prev, company: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Lead Source</label>
                <select 
                  className="w-full bg-[#0a0a0c] border border-white/5 focus:border-[#00f0ff] focus:outline-none rounded-xl p-3 text-xs text-slate-200 transition-all"
                  value={newLeadForm.source}
                  onChange={(e) => setNewLeadForm(prev => ({ ...prev, source: e.target.value }))}
                >
                  <option value="WEBSITE">Website Form Inbound</option>
                  <option value="APIFY">Apify Local Maps Scraper</option>
                  <option value="WHATSAPP">WhatsApp Intake</option>
                  <option value="SMS">Twilio SMS Gateway</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-bold uppercase rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-tr from-[#00f0ff] to-[#6366f1] text-xs font-bold uppercase rounded-lg"
                >
                  Save CRM Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Client Tax Console Modal */}
      {selectedConsoleClient && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass w-full max-w-xl p-6 space-y-5 border border-[#00f0ff]/20 relative shadow-[0_0_50px_rgba(0,240,255,0.1)] text-left">
            
            {/* Header */}
            <div className="flex justify-between items-start border-b border-white/5 pb-4">
              <div>
                <span className="text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider block mb-1">
                  Client Tax Console
                </span>
                <h3 className="text-xl font-bold tracking-tight text-white">{selectedConsoleClient.user.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedConsoleClient.companyName || 'Individual Taxpayer'} • {selectedConsoleClient.taxType} (TY {selectedConsoleClient.taxYear})
                </p>
              </div>
              <button 
                onClick={() => setSelectedConsoleClient(null)}
                className="text-slate-400 hover:text-white font-extrabold text-sm"
              >
                ✕ Close
              </button>
            </div>

            {/* Document List */}
            <div className="space-y-3">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Uploaded Client Documents
                </h4>
                
                {consoleDocs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedConsoleDocs.length === consoleDocs.length) {
                          setSelectedConsoleDocs([]);
                        } else {
                          setSelectedConsoleDocs(consoleDocs.map(d => d.id));
                        }
                      }}
                      className="px-2 py-1 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-[9px] font-bold uppercase rounded transition-all"
                    >
                      {selectedConsoleDocs.length === consoleDocs.length ? 'Deselect All' : 'Select All'}
                    </button>
                    {selectedConsoleDocs.length > 0 && (
                      <>
                        <button
                          onClick={handleDownloadSelected}
                          className="px-2.5 py-1 bg-white/10 hover:bg-white/15 text-white text-[10px] font-extrabold uppercase rounded-lg border border-white/15 transition-all flex items-center gap-1"
                          title="Download selected as ZIP archive"
                        >
                          📥 ZIP ({selectedConsoleDocs.length})
                        </button>
                        <button
                          onClick={handleMergeSelected}
                          className="px-2.5 py-1 bg-[#00f0ff] hover:bg-cyan-400 text-slate-900 text-[10px] font-extrabold uppercase rounded-lg shadow-[0_0_10px_rgba(0,240,255,0.2)] transition-all flex items-center gap-1"
                          title="Merge selected files into a single PDF document"
                        >
                          🗂️ Merge ({selectedConsoleDocs.length})
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              
              {isLoadingDocs ? (
                <div className="p-4 text-center text-slate-500 text-xs animate-pulse">
                  Loading files from vault...
                </div>
              ) : consoleDocs.length === 0 ? (
                <div className="p-4 text-center border border-dashed border-white/5 rounded-xl text-slate-500 text-xs">
                  No documents uploaded for this client yet.
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-[180px] overflow-y-auto pr-1 border border-white/5 rounded-xl bg-[#0a0a0c]/40">
                  {consoleDocs.map(doc => (
                    <div key={doc.id} className="p-3 flex justify-between items-center text-xs hover:bg-white/[0.01]">
                      <div className="flex items-center gap-2.5 overflow-hidden pr-2">
                        <input 
                          type="checkbox"
                          checked={selectedConsoleDocs.includes(doc.id)}
                          onChange={() => handleToggleDocSelection(doc.id)}
                          className="w-3.5 h-3.5 rounded border-white/10 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-[#0f0f12] cursor-pointer shrink-0"
                        />
                        <div className="overflow-hidden text-left">
                          <span className="font-semibold text-white block truncate max-w-[220px]">{doc.name}</span>
                          <div className="flex gap-2 items-center text-[10px] text-slate-500 mt-0.5">
                            <span className="bg-white/5 px-1.5 py-0.5 rounded font-black text-slate-400 uppercase text-[9px]">{doc.category}</span>
                            <span>•</span>
                            <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2 shrink-0">
                        <a 
                          href={`/accounting/api/crm/document/download?docId=${doc.id}&preview=true`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-[11px] font-bold rounded-lg transition-all"
                          title="Preview file inline"
                        >
                          👁️ Preview
                        </a>
                        <button 
                          onClick={() => triggerFileDownloadWithSavePicker(doc.id, doc.name)}
                          className="px-2.5 py-1.5 bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/20 text-[11px] font-bold rounded-lg transition-all"
                          title="Download file"
                        >
                          📥 Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CPA File Upload Form (Completed Tax Return) */}
            <div className="pt-4 border-t border-white/5 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Preparer Actions
              </h4>
              
              <div className="bg-[#050507] p-4 rounded-xl border border-white/5 relative">
                {isUploading && (
                  <div className="absolute inset-0 bg-black/70 rounded-xl flex items-center justify-center z-10">
                    <span className="text-xs text-[#00f0ff] font-bold animate-pulse">Uploading finalized tax return...</span>
                  </div>
                )}
                
                <span className="text-[10px] text-slate-400 font-bold block mb-1">
                  UPLOAD COMPLETED RETURN (PDF ONLY)
                </span>
                <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
                  Upload the finalized federal return. The system will save it in the client record and automatically advance this card to **In Review** stage.
                </p>
                
                <label className="flex flex-col items-center justify-center border border-dashed border-white/10 hover:border-[#00f0ff]/40 bg-white/[0.01] hover:bg-white/[0.02] cursor-pointer py-4 rounded-xl transition-all">
                  <span className="text-xs text-[#00f0ff] font-bold">📂 Click to Browse PDF</span>
                  <span className="text-[9px] text-slate-500 mt-1">Accepts standard PDF files up to 10MB</span>
                  <input 
                    type="file" 
                    accept="application/pdf"
                    className="hidden" 
                    onChange={handleUploadTaxReturn}
                    disabled={isUploading}
                  />
                </label>
              </div>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
