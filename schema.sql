-- ============================================================
-- Supabase Schema & Row Level Security (RLS) Migration
-- Senior Full-Stack Integration Engineer: Paid Client Access
-- ============================================================

-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 1. PROFILES TABLE (Mirrors auth.users)
-- ------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

-- Policy: Users can only view their own profile
create policy "Users can view own profile"
    on public.profiles
    for select
    using (auth.uid() = id);

-- Policy: Users can update their own profile
create policy "Users can update own profile"
    on public.profiles
    for update
    using (auth.uid() = id);

-- Trigger to automatically create a profile when a new user signs up in auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, new.raw_user_meta_data->>'full_name');
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- ------------------------------------------------------------
-- 2. SAMPLE DOCUMENTS TABLE (The paid digital asset)
-- ------------------------------------------------------------
create table if not exists public.sample_documents (
    id text primary key,
    title text not null,
    summary text not null,
    premium_content text not null,
    price_cents integer not null default 4900, -- e.g. $49.00
    currency text not null default 'usd',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.sample_documents enable row level security;

-- Anyone authenticated can view metadata/summary (to see what is available to buy)
create policy "Authenticated users can view document catalog"
    on public.sample_documents
    for select
    to authenticated
    using (true);

-- ------------------------------------------------------------
-- 3. ENTITLEMENTS TABLE (Access Rights)
-- ------------------------------------------------------------
create table if not exists public.entitlements (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    document_id text not null references public.sample_documents(id) on delete cascade,
    stripe_session_id text,
    stripe_payment_intent text,
    status text not null default 'active' check (status in ('active', 'revoked')),
    granted_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_user_document_entitlement unique (user_id, document_id)
);

alter table public.entitlements enable row level security;

-- Strict Isolation: Clients can only see their own entitlements
create policy "Users can view own entitlements"
    on public.entitlements
    for select
    to authenticated
    using (auth.uid() = user_id);

-- Direct client INSERT/UPDATE/DELETE forbidden: entitlements can only be managed by server service_role
create policy "Service role manages entitlements"
    on public.entitlements
    for all
    to service_role
    using (true)
    with check (true);


-- ------------------------------------------------------------
-- 4. CRM SYNC RECORDS TABLE (Tracks Zoho Sync State & Failures)
-- ------------------------------------------------------------
create table if not exists public.crm_sync_records (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    zoho_deal_id text not null,
    document_id text not null references public.sample_documents(id),
    stripe_event_id text,
    status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
    attempts integer not null default 0,
    last_error text,
    last_attempted_at timestamp with time zone,
    synced_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_user_deal_document unique (user_id, zoho_deal_id, document_id)
);

alter table public.crm_sync_records enable row level security;

-- Strict Isolation: Clients can only see their own CRM sync status
create policy "Users can view own CRM sync records"
    on public.crm_sync_records
    for select
    to authenticated
    using (auth.uid() = user_id);

create policy "Service role manages CRM sync records"
    on public.crm_sync_records
    for all
    to service_role
    using (true)
    with check (true);


-- ------------------------------------------------------------
-- 5. PROCESSED WEBHOOK EVENTS TABLE (Idempotency Ledger)
-- ------------------------------------------------------------
create table if not exists public.processed_webhook_events (
    id text primary key, -- Stripe Event ID (e.g. evt_1Nxxxxxxxx)
    event_type text not null,
    processed_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.processed_webhook_events enable row level security;

create policy "Service role manages webhook events"
    on public.processed_webhook_events
    for all
    to service_role
    using (true)
    with check (true);


-- ------------------------------------------------------------
-- 6. SEED DATA (Default Sample Document)
-- ------------------------------------------------------------
insert into public.sample_documents (id, title, summary, premium_content, price_cents, currency)
values (
    'doc_enterprise_architecture_2026',
    'Enterprise Cloud Integration Blueprint (Confidential)',
    'Comprehensive architectural guide detailing secure multi-tenant cloud patterns, enterprise CRM synchronization, and idempotent payment pipelines.',
    '# CONFIDENTIAL: Enterprise Cloud Integration Blueprint (2026 Edition)

Welcome to the full confidential specification.

### 1. Architectural Principles
- **Decoupled Asynchronous Workflows**: Webhook ingestors must acknowledge receipt within 2000ms. External CRM synchronization must be non-blocking.
- **Idempotency Guarantee**: All mutating operations enforce unique idempotency keys at the persistence layer.
- **Strict Row-Level Security**: No client may query or mutate records without valid cryptographically-signed JWT claims matching `auth.uid()`.

### 2. Verified Access Token
This document access was verified through Stripe Test Checkout and granted via cryptographically verified Supabase Entitlement.
Your client identity and payment transaction are fully authenticated.',
    4900,
    'usd'
)
on conflict (id) do update set
    title = excluded.title,
    summary = excluded.summary,
    premium_content = excluded.premium_content,
    price_cents = excluded.price_cents;
