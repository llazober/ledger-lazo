# 📘 CPA Ledger App: Operational Training Manual

Welcome to the **CPA Ledger Platform** training manual. This manual outlines the exact operational procedures, technical endpoints, and database workflows for managing taxpayer accounts, document ingestion, audits, and automation.

---

## 1. 📂 Intelligent CRM Cockpit & Kanban Board

The CRM Cockpit is the primary interface for managing leads and client pipelines.

### 📅 Funnel Stages
Clients and leads progress through the following database-tracked stages:
*   `ONBOARDING` → `MISSING_DOCS` → `IN_PREPARATION` → `REVIEW` → `COMPLETED`

### 🖱️ Drag-and-Drop Pipeline
*   **Horizontal Reordering**: Drag cards left or right between columns to change client stages.
*   **Vertical Reordering**: Drag cards up or down within a stage column to prioritize accounts.
*   **Visual Indicators**: Dropzone columns will animate with a cyan glow to indicate active targets during drag operations.

### 🏆 The "WON" Lead Trigger
*   Changing a lead's status to **WON** initiates the automated onboarding sequence, provisionining a taxpayer client user profile linked to the client database.

---

## 2. 🗄️ Touchless Document Vault

The Document Vault manages taxpayer source files, audits, downloads, and merges.

### 📁 Allowed Ingestion Formats
To maintain a clean and standardized database, **only PDF documents are kept in the final vault**.
*   **Automatic Image-to-PDF Conversion**: 
    *   If a client uploads image formats (`PNG`, `JPG`, `JPEG`), the vault uses `pdf-lib` to convert them into a single-page PDF **on the fly**.
    *   Un-supported files (e.g. `.xlsx`, `.docx`) uploaded directly to the vault will be blocked with an warning alert.

### ⚡ Batch Actions
Select multiple documents using the checkbox triggers to perform batch operations:
*   **Batch Download (ZIP)**: Compiles all selected PDF files into a single, downloadable ZIP file to prevent multiple browser save-dialog prompts.
*   **Batch PDF Merge**: Merges all selected PDF documents into a single, multi-page PDF document.
*   *Note: Non-PDF documents selected in batch actions are skipped automatically with a user notice.*

---

## 3. ⚙️ Touchless CPA Inbound Email & Audit Automation

The platform is integrated with email parsers (like **n8n**) to process documents sent directly from taxpayers.

### 📥 Inbound Webhook (`POST /api/crm/incoming-email`)
n8n parses client email attachments and submits them to this endpoint:
*   **Target URL**: `https://portal.datalazo.net/accounting/api/crm/incoming-email`
*   **Payload Schema**:
    ```json
    {
      "fromEmail": "client@example.com",
      "fromName": "Client Name",
      "subject": "Tax returns for 1120S",
      "bodyText": "Attached are my documents.",
      "attachments": [
        {
          "name": "statement.png",
          "fileSize": 32768,
          "fileType": "PNG",
          "base64Data": "base64_encoded_string..."
        }
      ]
    }
    ```

### 🧠 OpenAI Document Classifier
Upon ingestion, the endpoint sends files to OpenAI GPT-4o-mini to:
1.  Verify if the document is readable.
2.  Classify the document type (e.g. `Bank_Statement`, `Tax_Notice`, `W2`, `1099-NEC`).
3.  Store metadata and a summary directly in the database.
4.  *Note: Emailed images are converted into PDFs server-side before database storage.*

### 📋 Modular Tax Completeness Audit
The system automatically compares received files against configured requirements for the client's `taxType`:
*   **Individual (1040)**: Requires at least one Tax Form (`W2` or `1099`) and one `Bank_Statement`.
*   **S-Corp (1120S)**: Requires at least one `Bank_Statement` and `Corporate_Ledger`.
*   **Funnel Routing**:
    *   **Incomplete**: If requirements are missing, client is set to `MISSING_DOCS` and an automated email listing the missing documents is sent.
    *   **Complete**: If all requirements are met, client is set to `IN_PREPARATION` and the assigned accountant is notified.

---

## 4. 🏆 Client Sign-Off Webhook (`POST /api/crm/client/sign-off`)

When tax returns are completed by the accountant, they are moved to `REVIEW` and sent to the client. Once the client approves, n8n/Resend calls this endpoint to complete the loop:
*   **Target URL**: `https://portal.datalazo.net/accounting/api/crm/client/sign-off`
*   **Payload Schema**:
    ```json
    {
      "clientId": "client_id_here",
      "email": "client_email@example.com"
    }
    ```
*   **Action**: Automatically transitions the client's status to `COMPLETED` in the database.

---

## 5. 🔌 How to Import Workflows into n8n

Follow these steps to import the configured workflow files into your n8n workspace:

1. **Copy JSON**: Open either [n8n_workflow_1_review.json](file:///c:/Users/luisl/Accounting%20App/n8n_workflow_1_review.json) or [n8n_workflow_2_signoff.json](file:///c:/Users/luisl/Accounting%20App/n8n_workflow_2_signoff.json) in your editor, select all text (`Ctrl + A` / `Cmd + A`), and copy it (`Ctrl + C` / `Cmd + C`).
2. **Open n8n**: Open your n8n editor cockpit in your browser.
3. **Create Workflow**: Click **"+ Add workflow"** in the top-right corner to open a blank canvas.
4. **Paste Nodes**: Click on the empty grid canvas and paste (`Ctrl + V` / `Cmd + V`). The nodes and connection pathways will appear instantly.
5. **Set Credentials**:
   * Double-click the **Resend** / HTTP Request nodes and select or create your Resend API header credentials.
   * Double-click the **IMAP Email Trigger** and configure your firm's email credentials.
6. **Activate**: Click the **"Active"** toggle in the top-right corner to go live.

---
*Generated for CPA Ledger App | v3.6 — Fulfillment Automation*
