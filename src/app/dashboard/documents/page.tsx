import React from 'react';
import { prisma } from '@/lib/prisma';
import DocumentVault from '@/components/DocumentVault';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DocumentsPage() {
  try {
    let docs = await prisma.document.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const clients = await prisma.client.findMany({
      include: {
        user: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Self-seeding mock documents for demo if empty
    if (docs.length === 0) {
      console.log("Documents table is empty, seeding mock CPA documents...");
      
      const seedDocs = [
        {
          name: 'Google-2025-W2.pdf',
          url: '#',
          fileType: 'PDF',
          fileSize: 420500,
          taxYear: 2025,
          category: 'W2',
          status: 'VALIDATED',
          extractedText: 'Form W-2 Wage and Tax Statement 2025\nBox 1 Wages: $94,500.00\nBox 2 Federal Income Tax withheld: $14,200.00\nEmployer: Google Inc',
          aiSummary: 'W-2 Wage Statement from Google Inc for tax year 2025. Wages: $94,500.00, Federal tax withheld: $14,200.00.',
          confidenceScore: 0.98,
        },
        {
          name: 'Upwork-1099-NEC.jpg',
          url: '#',
          fileType: 'JPG',
          fileSize: 180200,
          taxYear: 2026,
          category: '1099-NEC',
          status: 'VALIDATED',
          extractedText: 'Form 1099-NEC Nonemployee Compensation\nBox 1: $12,000.00\nPayer: Upwork Inc\nRecipient: Luis Lazo',
          aiSummary: '1099-NEC Nonemployee Compensation from Upwork Inc. Total gross payments: $12,000.00. Categorized as Schedule C freelance revenue.',
          confidenceScore: 0.97,
        },
        {
          name: 'Chase-Checking-Statement.pdf',
          url: '#',
          fileType: 'PDF',
          fileSize: 1048000,
          taxYear: 2026,
          category: 'Bank_Statement',
          status: 'REVIEW_REQUIRED',
          extractedText: 'Chase Business Checking Statement\nBeginning Balance: $25,000.00\nEnding Balance: $18,400.00\nFlagged Transactions: Transfer $5,000.00 to Personal savings',
          aiSummary: 'Chase checking statement. Ending Balance: $18,400.00. Note: Contains an unclassified personal distribution transfer of $5,000.',
          confidenceScore: 0.88,
          validationErrors: 'Flagged $5,000 personal savings transfer for accountant check.',
        }
      ];

      for (const d of seedDocs) {
        await prisma.document.create({ data: d });
      }

      docs = await prisma.document.findMany({
        orderBy: { createdAt: 'desc' }
      });
    }

    const serializedDocs = docs.map((doc: any) => ({
      ...doc,
      extractedText: doc.extractedText || null,
      aiSummary: doc.aiSummary || null,
      validationErrors: doc.validationErrors || null,
      createdAt: doc.createdAt.toISOString()
    }));

    const serializedClients = clients.map((client: any) => ({
      id: client.id,
      name: client.user.name,
      companyName: client.companyName || null,
      taxType: client.taxType
    }));

    return (
      <DashboardWrapper>
        <DocumentVault 
          initialDocs={serializedDocs} 
          clients={serializedClients}
        />
      </DashboardWrapper>
    );
  } catch (error) {
    console.error('Documents Page Connection Error:', error);
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center p-6 space-y-4">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-2 border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">Database Core Connection Failure</h1>
        <p className="text-slate-400 text-xs max-w-sm mx-auto leading-relaxed">
          The CPA Document Vault was unable to connect to `ledger_lazo`. Please ensure your environment settings are valid and the remote PostgreSQL host is active.
        </p>
      </div>
    );
  }
}

// Minimalist wrapper to align layout structure properly
function DashboardWrapper({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-transparent">{children}</div>;
}
