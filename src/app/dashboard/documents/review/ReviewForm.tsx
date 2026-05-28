"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ReviewFormProps {
  initialDoc: {
    id: string;
    name: string;
    url: string;
    fileType: string;
    fileSize: number;
    taxYear: number;
    category: string;
    status: string;
    extractedText: string;
    aiSummary: string;
    confidenceScore: number;
    validationErrors: string | null;
    fileData: string | null;
    humanVerified: boolean;
    clientName: string;
    taxFormData: {
      id: string;
      formType: string;
      boxes: Record<string, any>;
    } | null;
    createdAt: string;
  };
}

const TAX_FORM_LABELS: Record<string, { label: string; key: string; isMonetary?: boolean; isMono?: boolean }[]> = {
  w2: [
    { label: "Box a: Employee SSN", key: "employeeSsn", isMono: true },
    { label: "Box b: Employer EIN", key: "employerEin", isMono: true },
    { label: "Box 1: Wages/Tips", key: "wages", isMonetary: true },
    { label: "Box 2: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true },
    { label: "Box 3: SS Wages", key: "socialSecurityWages", isMonetary: true },
    { label: "Box 4: SS Tax Withheld", key: "socialSecurityTax", isMonetary: true },
    { label: "Box 5: Medicare Wages", key: "medicareWages", isMonetary: true },
    { label: "Box 6: Medicare Tax", key: "medicareTax", isMonetary: true }
  ],
  "1099-nec": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Recipient SSN/TIN", key: "recipientSsn", isMono: true },
    { label: "Box 1: Nonemployee Comp", key: "nonemployeeCompensation", isMonetary: true },
    { label: "Box 4: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true }
  ],
  "1099-misc": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Recipient SSN/TIN", key: "recipientSsn", isMono: true },
    { label: "Box 1: Rents", key: "rents", isMonetary: true },
    { label: "Box 2: Royalties", key: "royalties", isMonetary: true },
    { label: "Box 3: Other Income", key: "otherIncome", isMonetary: true },
    { label: "Box 4: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true },
    { label: "Box 8: Substitute Payments", key: "substitutePayments", isMonetary: true }
  ],
  "1099-int": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Recipient SSN/TIN", key: "recipientSsn", isMono: true },
    { label: "Box 1: Interest Income", key: "interestIncome", isMonetary: true },
    { label: "Box 4: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true }
  ],
  "1099-div": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Recipient SSN/TIN", key: "recipientSsn", isMono: true },
    { label: "Box 1a: Ordinary Dividends", key: "totalOrdinaryDividends", isMonetary: true },
    { label: "Box 1b: Qualified Dividends", key: "qualifiedDividends", isMonetary: true },
    { label: "Box 2a: Cap Gain Dist", key: "totalCapitalGainDist", isMonetary: true },
    { label: "Box 4: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true }
  ],
  "1099-ssa": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Box 2: Recipient SSN", key: "recipientSsn", isMono: true },
    { label: "Box 3: Benefits Paid", key: "benefitsPaid", isMonetary: true },
    { label: "Box 4: Benefits Repaid", key: "benefitsRepaid", isMonetary: true },
    { label: "Box 5: Net Benefits", key: "netBenefits", isMonetary: true },
    { label: "Box 6: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true },
    { label: "Box 7: Address", key: "address" },
    { label: "Box 8: Claim Number", key: "claimNumber", isMono: true }
  ],
  "ssa-1099": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Box 2: Recipient SSN", key: "recipientSsn", isMono: true },
    { label: "Box 3: Benefits Paid", key: "benefitsPaid", isMonetary: true },
    { label: "Box 4: Benefits Repaid", key: "benefitsRepaid", isMonetary: true },
    { label: "Box 5: Net Benefits", key: "netBenefits", isMonetary: true },
    { label: "Box 6: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true },
    { label: "Box 7: Address", key: "address" },
    { label: "Box 8: Claim Number", key: "claimNumber", isMono: true }
  ],
  "1099-r": [
    { label: "Payer EIN/TIN", key: "payerEin", isMono: true },
    { label: "Recipient SSN/TIN", key: "recipientSsn", isMono: true },
    { label: "Box 1: Gross Distribution", key: "grossDistribution", isMonetary: true },
    { label: "Box 2a: Taxable Amount", key: "taxableAmount", isMonetary: true },
    { label: "Box 4: Fed Tax Withheld", key: "fedIncomeTax", isMonetary: true },
    { label: "Box 7: Distribution Code", key: "distributionCode", isMono: true },
    { label: "Box 8: Other Income", key: "otherIncome", isMonetary: true },
    { label: "Box 14: State Tax Withheld", key: "stateIncomeTax", isMonetary: true },
    { label: "Box 16: State Distribution", key: "stateDistribution", isMonetary: true }
  ],
  "1095-a": [
    { label: "Box 1: Marketplace Id", key: "marketplaceIdentifier", isMono: true },
    { label: "Box 2: Policy Number", key: "policyNumber", isMono: true },
    { label: "Box 4: Recipient Name", key: "recipientName" },
    { label: "Box 5: Recipient SSN", key: "recipientSsn", isMono: true },
    { label: "Box 8: Spouse SSN", key: "spouseSsn", isMono: true },
    { label: "Box 10: Policy Start Date", key: "policyStartDate", isMono: true },
    { label: "Box 11: Policy End Date", key: "policyTerminationDate", isMono: true },
    { label: "Box 33A: Annual Premiums", key: "annualEnrollmentPremiums", isMonetary: true },
    { label: "Box 33B: Annual SLCSP Premium", key: "annualSlcspPremium", isMonetary: true },
    { label: "Box 33C: Annual Advance PTC", key: "annualAdvancePtc", isMonetary: true }
  ],
  "1098": [
    { label: "Lender EIN/TIN", key: "lenderEin", isMono: true },
    { label: "Borrower SSN/TIN", key: "borrowerSsn", isMono: true },
    { label: "Box 1: Mortgage Interest", key: "mortgageInterest", isMonetary: true },
    { label: "Box 2: Outstanding Principal", key: "outstandingPrincipal", isMonetary: true },
    { label: "Box 3: Origination Date", key: "originationDate", isMono: true },
    { label: "Box 4: Interest Refund", key: "interestRefund", isMonetary: true },
    { label: "Box 5: Mortgage Insurance", key: "mortgageInsurance", isMonetary: true },
    { label: "Box 6: Points Paid", key: "pointsPaid", isMonetary: true },
    { label: "Box 7: Property Address", key: "propertyAddress" },
    { label: "Box 10: Real Estate Taxes", key: "realEstateTaxes", isMonetary: true }
  ]
};

export default function ReviewForm({ initialDoc }: ReviewFormProps) {
  const router = useRouter();
  const categoryKey = initialDoc.category.toLowerCase();
  
  // Standard fields mapped for the category, fallback to raw keys
  const fields = TAX_FORM_LABELS[categoryKey] || 
                 Object.keys(initialDoc.taxFormData?.boxes || {}).map(k => ({
                   label: k.toUpperCase(),
                   key: k,
                   isMonetary: typeof initialDoc.taxFormData?.boxes[k] === 'number',
                   isMono: typeof initialDoc.taxFormData?.boxes[k] === 'string'
                 }));

  // Initializing state for boxes
  const [boxes, setBoxes] = useState<Record<string, any>>(() => {
    const b: Record<string, any> = {};
    fields.forEach(field => {
      b[field.key] = initialDoc.taxFormData?.boxes[field.key] ?? '';
    });
    return b;
  });

  const [humanVerified, setHumanVerified] = useState(initialDoc.humanVerified);
  const [taxYear, setTaxYear] = useState(initialDoc.taxYear);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleInputChange = (key: string, value: string) => {
    setBoxes(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/accounting/api/crm/document', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId: initialDoc.id,
          boxes,
          humanVerified,
          taxYear
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save changes');
      }

      setStatus({ type: 'success', message: 'Document data verified and saved successfully!' });
      
      // Delay navigation slightly to let the user see the success state
      setTimeout(() => {
        router.push(`/dashboard/documents?selectedId=${initialDoc.id}`);
        router.refresh();
      }, 1000);

    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'An error occurred while saving.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
      {/* Left Panel: Field Form Editor (5 cols) */}
      <div className="lg:col-span-5 flex flex-col space-y-6">
        <div className="glass p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-cyan-400 font-extrabold bg-[#00f0ff]/5 px-2.5 py-1 rounded border border-cyan-400/20 uppercase tracking-wider">
              {initialDoc.category} Form Fields
            </span>
            <span className="text-[10px] text-slate-400 font-bold">
              Tax Year: {taxYear}
            </span>
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed">
            Verify and correct the extracted values from the document. Once verified, check the Human Verified box and save to finalize database entry.
          </p>

          <div className="space-y-4 pt-2">
            {fields.length === 0 ? (
              <div className="space-y-3">
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">
                    Tax Year
                  </label>
                  <input
                    type="number"
                    value={taxYear}
                    onChange={(e) => setTaxYear(Number(e.target.value))}
                    className="w-full bg-[#0a0a0c] border border-white/10 hover:border-white/20 focus:border-cyan-500/50 rounded-xl py-2.5 px-3 text-white font-mono text-xs transition-all focus:outline-none focus:ring-0"
                  />
                </div>
                <p className="text-xs text-slate-500 text-center py-6">
                  No extracted fields available for this document category.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {/* Editable Tax Year Field */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">
                    Tax Year
                  </label>
                  <input
                    type="number"
                    value={taxYear}
                    onChange={(e) => setTaxYear(Number(e.target.value))}
                    className="w-full bg-[#0a0a0c] border border-white/10 hover:border-white/20 focus:border-cyan-500/50 rounded-xl py-2.5 px-3 text-white font-mono text-xs transition-all focus:outline-none focus:ring-0"
                  />
                </div>

                {fields.map((field) => {
                  const val = boxes[field.key];
                  return (
                    <div key={field.key} className="flex flex-col space-y-1">
                      <label className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">
                        {field.label}
                      </label>
                      <div className="relative">
                        {field.isMonetary && (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-semibold">
                            $
                          </span>
                        )}
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => handleInputChange(field.key, e.target.value)}
                          placeholder={field.isMonetary ? "0.00" : "Not Found"}
                          className={`w-full bg-[#0a0a0c] border border-white/10 hover:border-white/20 focus:border-cyan-500/50 rounded-xl py-2.5 text-white font-mono text-xs transition-all focus:outline-none focus:ring-0 ${
                            field.isMonetary ? 'pl-7' : 'px-3'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Verification Status Checkbox Card */}
          <div className="pt-2">
            <label className={`flex items-start gap-3.5 p-4 rounded-xl cursor-pointer transition-all select-none border ${
              humanVerified 
                ? 'bg-emerald-500/5 border-emerald-500/30' 
                : 'bg-cyan-950/5 border-cyan-500/20 hover:bg-cyan-950/10'
            }`}>
              <input
                type="checkbox"
                checked={humanVerified}
                onChange={(e) => setHumanVerified(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-white uppercase tracking-wider block">
                  Human Verified
                </span>
                <span className="text-[10px] text-slate-400 block leading-relaxed">
                  I confirm that I have reviewed the original document scan, and these fields match the legal form values.
                </span>
              </div>
            </label>
          </div>

          {/* Status Message Display */}
          {status && (
            <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 animate-fadeIn ${
              status.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}>
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {status.type === 'success' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                )}
              </svg>
              <span>{status.message}</span>
            </div>
          )}

          {/* Action CTAs */}
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={() => {
                router.push(`/dashboard/documents?selectedId=${initialDoc.id}`);
                router.refresh();
              }}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-extrabold text-xs tracking-wider uppercase py-3 rounded-xl border border-white/10 transition-all text-center"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#00f0ff] hover:bg-[#00d0dd] text-black font-extrabold text-xs tracking-wider uppercase py-3 rounded-xl border border-cyan-400/20 shadow-[0_0_20px_rgba(0,240,255,0.15)] hover:shadow-[0_0_25px_rgba(0,240,255,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-1.5">
                  <svg className="animate-spin h-4 w-4 text-black" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                'Save & Verify'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel: Document Viewer with custom scroll (7 cols) */}
      <div className="lg:col-span-7 flex flex-col space-y-3">
        <div className="flex justify-between items-center px-1">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
            Original Document Viewport
          </span>
          <span className="text-[9px] text-slate-400 italic">
            Scroll vertically & horizontally to inspect coordinates
          </span>
        </div>

        {initialDoc.fileData ? (
          <div className="w-full h-[calc(100vh-220px)] border border-white/10 rounded-xl overflow-auto bg-[#0a0a0c] relative flex items-start justify-center p-4">
            {initialDoc.fileType.toUpperCase() === 'PDF' ? (
              <iframe
                src={`/accounting/api/crm/document/download?docId=${initialDoc.id}&preview=true`}
                className="w-full h-full min-w-[750px] min-h-[950px] border-none bg-slate-900 shadow-2xl rounded-lg"
                title={initialDoc.name}
              />
            ) : (
              <img
                src={`/accounting/api/crm/document/download?docId=${initialDoc.id}&preview=true`}
                className="max-w-none w-auto h-auto min-w-[850px] bg-slate-900 shadow-2xl rounded-lg border border-white/5 select-none"
                alt={initialDoc.name}
              />
            )}
          </div>
        ) : (
          <div className="w-full h-[calc(100vh-220px)] border border-white/10 rounded-xl flex flex-col items-center justify-center bg-[#0a0a0c] p-6 space-y-2">
            <svg className="w-10 h-10 text-slate-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs text-slate-500 font-semibold uppercase">No Document Binary Stored</span>
            <span className="text-[10px] text-slate-600 text-center max-w-xs">
              This mock or reference document lacks direct base64 contents in the database.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
