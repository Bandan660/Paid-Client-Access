# Senior Full-Stack Integration Engineer: Paid Client Access

A production-grade integration between **Stripe Test Checkout**, **Supabase (Identity & RLS Access Control)**, and **Zoho CRM (Developer Edition)**.

Built with **React (Vite + TypeScript)**, **Node.js (Express + TypeScript)**, and **Supabase (PostgreSQL with Row-Level Security)**.

---

## Architecture & Security Highlights

```
+-------------------------------------------------------------------+
|                        Client Browser (React)                     |
| - Authenticates with Supabase Auth                                |
| - Reads entitlement status & document strictly via Supabase RLS   |
| - Triggers Stripe Checkout & Zoho Sync Retry via Server API       |
+-------------------+---------------------------+-------------------+
                    |                           |
         Direct RLS | Read                      | API Calls
         (Anon Key) |                           | (No Secrets Exposed)
                    v                           v
+-------------------------------+   +-------------------------------+
|       Supabase Backend        |   |    Node.js / Express Server   |
| - auth.users (Client identity)|   | - POST /api/checkout          |
| - entitlements (RLS enforced) |<==| - POST /api/webhook (Stripe)  |
| - sample_documents (Catalog)  |   | - POST /api/crm/retry         |
| - crm_sync_records (Audit)    |   | - GET  /api/crm/status/:id    |
| - processed_webhook_events    |   +---------------+---------------+
+-------------------------------+                   |
                                                    | Zoho REST API v2
                                                    | (OAuth 2.0 Refresh)
                                                    v
                                    +-------------------------------+
                                    |    Zoho CRM (Dev Edition)     |
                                    | - Updates Deal: 'Closed Won'  |
                                    +-------------------------------+
```

### 1. Strict Server/Client Credential Isolation
- The **React client** only receives public keys (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and Zoho OAuth credentials (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`) remain **strictly on the server**.

### 2. Multi-Tenant Row-Level Security (RLS)
- The database enforces data isolation at the PostgreSQL engine level.
- Client A cannot read Client B's document, entitlement status, or CRM sync records even if they manipulate client-side queries.

### 3. Decoupled Resilience & Failure Handling
- If Zoho CRM is down, rate-limited, or returns a 5xx error, **the client's document access is NEVER blocked or revoked**.
- The CRM sync record is marked as `pending` with the exact diagnostic error.
- A manual retry action is provided in the UI as well as via CLI command (`npm run retry-crm-sync`).

### 4. Idempotency Guarantees
- Stripe webhook events are checked against the `processed_webhook_events` ledger table.
- Entitlements enforce a unique constraint `(user_id, document_id)`.
- Replaying a webhook event will return HTTP 200 without creating a duplicate entitlement or redundant Zoho CRM update.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) (for local webhook testing)
- A free [Supabase](https://supabase.com/) project
- A [Zoho CRM Developer Edition](https://www.zoho.com/crm/developer/) account

---

## Step 1: Database Setup (Supabase)

1. Open your Supabase project's **SQL Editor**.
2. Open [`schema.sql`](./schema.sql) from this repository, copy its contents, and execute it.
3. This creates:
   - `profiles` with auth triggers.
   - `sample_documents` with default seed document (`doc_enterprise_architecture_2026`).
   - `entitlements` with unique constraints and RLS policies.
   - `crm_sync_records` tracking Zoho sync state and retry history.
   - `processed_webhook_events` enforcing event idempotency.

---

## Step 2: Configure Environment Variables

Create `.env` in the project root by copying the template:

```bash
cp .env.example .env
```

Populate the required credentials:

```ini
PORT=5000
CLIENT_URL=http://localhost:5173
VITE_BACKEND_URL=http://localhost:5000

# Supabase Credentials (from Settings -> API)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# Stripe Credentials (from Dashboard -> Developers -> API Keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Zoho CRM Credentials (from api-console.zoho.com)
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com
ZOHO_API_DOMAIN=https://www.zohoapis.com
ZOHO_CLIENT_ID=1000.XXXXX...
ZOHO_CLIENT_SECRET=XXXXX...
ZOHO_REFRESH_TOKEN=1000.XXXXX...
ZOHO_DEAL_STAGE_PAID="Closed Won"
DEFAULT_ZOHO_DEAL_ID=DEMO_DEAL_1001

# Outage simulation flag (set to 'true' to demo Zoho downtime handling)
SIMULATE_ZOHO_FAILURE=false
```

---

## Step 3: Install & Start Development Servers

### 1. Install Dependencies
```bash
# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
cd ..
```

### 2. Start Both Servers
In two separate terminal tabs:

**Tab 1: Backend Server**
```bash
npm run dev:server
# Server starts at http://localhost:5000
```

**Tab 2: React Frontend**
```bash
npm run dev:client
# Client starts at http://localhost:5173
```

---

## Step 4: Webhook Testing & Idempotency Verification

Use the **Stripe CLI** to forward test webhooks to your local server:

### 1. Login to Stripe CLI
```bash
stripe login
```

### 2. Forward Webhooks to Express Backend
```bash
stripe listen --forward-to localhost:5000/api/webhook
```
The CLI will output your local webhook signing secret:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxx
```
Copy this value into your `.env` as `STRIPE_WEBHOOK_SECRET` and restart the server.

### 3. Verify Idempotency (Event Replay)
To test that duplicate events do not create multiple entitlements or duplicate CRM updates:
1. Complete a test purchase in the portal.
2. In the Stripe CLI terminal, locate the `checkout.session.completed` event ID (e.g. `evt_1Nxxxxxxxxxxxx`).
3. Resend the exact event:
   ```bash
   stripe events resend evt_1Nxxxxxxxxxxxx
   ```
4. Observe the backend log:
   ```
   [Webhook] Idempotency: Event evt_1Nxxxxxxxxxxxx already processed. Acknowledging without duplicate action.
   ```
5. Check your Supabase database: No duplicate rows in `entitlements` or `crm_sync_records`.

---

## Step 5: Testing Zoho CRM Resilience & Retry

### Happy Path (Zoho Online)
1. In the portal, enter a valid Zoho Deal ID (or keep default `DEMO_DEAL_1001`).
2. Click **Purchase Access ($49.00 USD)**.
3. Complete Stripe test checkout using `4242 4242 ...`.
4. The client returns to the portal:
   - Document immediately unlocks (`Access Active`).
   - Zoho CRM Deal status shows `Synced` with 1 attempt.
   - In Zoho CRM, Deal stage is marked **Closed Won**.

### Failure & Retry Path (Zoho Down / Outage)
1. In `.env`, set:
   ```ini
   SIMULATE_ZOHO_FAILURE=true
   ```
   *(Or enter an invalid Zoho Deal ID / disable internet to Zoho).*
2. Complete a test purchase.
3. Notice:
   - **Client's document access is still 100% granted** (not blocked).
   - Zoho CRM Sync card displays: `Pending Sync` with diagnostic message `SIMULATED_OUTAGE: Zoho CRM gateway did not respond within timeout.`
4. To test the retry:
   - In `.env`, revert `SIMULATE_ZOHO_FAILURE=false`.
   - **Option A (UI)**: Click the **↻ Retry Zoho CRM Update** button in the portal.
   - **Option B (CLI)**: Run the command line retry tool:
     ```bash
     npm run retry-crm-sync
     ```
   - Status updates immediately to `Synced`!

---

## 15-Minute Walkthrough Demonstration Script

| Time | Topic | Demonstration |
| :--- | :--- | :--- |
| **0:00 - 3:00** | Architecture & Security Overview | Explain the React + Node Express + Supabase split. Show that client bundle contains only public anon keys, while Stripe and Zoho secrets are isolated on the server. |
| **3:00 - 6:00** | Multi-Tenant Isolation (RLS) | Log in as Client A (`client_a@enterprise.com`). Show that Client B's data is completely hidden via Supabase RLS. |
| **6:00 - 9:00** | Purchase Flow & Stable IDs | Initiate checkout. Inspect Stripe Session metadata containing stable `user_id`, `document_id`, and `zoho_deal_id`. Show webhook signature verification and entitlement grant. |
| **9:00 - 12:00** | Idempotency Verification | Trigger Stripe CLI `stripe events resend <event_id>`. Show server log acknowledging the event idempotently without duplicate records. |
| **12:00 - 15:00** | Zoho Outage & Retry | Toggle `SIMULATE_ZOHO_FAILURE=true`. Show document unlocking even while Zoho fails. Show diagnostic error in portal. Run `npm run retry-crm-sync` (or click retry in UI) to demonstrate self-healing sync. |
