-- Ella data store. Apply with: npm run db:apply (runs this file against SUPABASE_DB_URL).
-- Safe to rerun: every statement is idempotent.
--
-- Access model:
--   * Vercel functions and local scripts write with the service role key (bypasses RLS).
--   * The public dashboard reads with the anon key, and only through the public_* views,
--     which show demo and test calls only, so real callers' details are never public.

create extension if not exists pgcrypto;

-- One row per call. Keyed on Vapi's call ID so retried webhooks never duplicate.
create table if not exists calls (
  id              text primary key,                 -- Vapi call ID
  client_id       text not null,
  started_at      timestamptz,
  ended_at        timestamptz,
  duration_s      integer,
  channel         text check (channel in ('phone', 'web', 'chat', 'test')),
  caller_number   text,
  intent          text,                              -- intent id from the client config
  route           text,                              -- department key, or null
  route_reason    text,
  outcome         text check (outcome in ('transferred', 'transfer_failed', 'sms_sent', 'lead_captured', 'booked', 'callback', 'no_action', 'failed')),
  ended_reason    text,                              -- Vapi's endedReason
  cost_usd        numeric(10, 4),
  recording_url   text,
  transcript      text,
  summary         text,
  is_demo         boolean not null default false,    -- seeded synthetic calls
  is_test         boolean not null default false,    -- test harness calls
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists calls_started_at_idx on calls (started_at desc);

-- Lead captured during a call. log_lead may be called several times per call; the latest wins.
create table if not exists leads (
  call_id                    text primary key references calls (id) on delete cascade,
  client_id                  text not null,
  intent                     text,
  caller_need                text,
  full_name                  text,
  phone                      text,
  email                      text,
  property_address           text,
  property_type              text check (property_type in ('residential', 'commercial')),
  company_name               text,
  facility_type              text,
  roof_size_or_buildings     text,
  pm_name                    text,
  invoice_or_account_number  text,
  urgency                    text check (urgency in ('emergency', 'high', 'normal')),
  callback_requested         boolean default false,
  sms_opt_in                 boolean default false,
  summary                    text,
  hubspot_contact_id         text,
  hubspot_record_id          text,                   -- task or ticket created for follow-up
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Every side effect we attempted (alert, SMS, push, booking, CRM write), for the dashboard and tests.
create table if not exists actions (
  id          uuid primary key default gen_random_uuid(),
  call_id     text references calls (id) on delete cascade,
  kind        text not null check (kind in ('sms', 'push', 'booking', 'crm_contact', 'crm_task', 'crm_ticket', 'email', 'transfer')),
  status      text not null check (status in ('ok', 'failed', 'skipped')),
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists actions_call_idx on actions (call_id);

create table if not exists errors (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                         -- e.g. 'tool:log_lead', 'webhook:end-of-call', 'hubspot'
  message     text not null,
  call_id     text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists errors_created_idx on errors (created_at desc);

create table if not exists test_runs (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  passed      integer default 0,
  failed      integer default 0,
  git_sha     text
);

create table if not exists test_results (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references test_runs (id) on delete cascade,
  persona     text not null,
  passed      boolean not null,
  assertions  jsonb not null,                        -- [{name, passed, detail}]
  transcript  text,
  call_id     text,
  created_at  timestamptz not null default now()
);
create index if not exists test_results_run_idx on test_results (run_id);

-- Keep updated_at current.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists calls_touch on calls;
create trigger calls_touch before update on calls for each row execute function touch_updated_at();
drop trigger if exists leads_touch on leads;
create trigger leads_touch before update on leads for each row execute function touch_updated_at();

-- RLS on: with no policies, anon and authenticated users can read nothing from the base tables.
alter table calls        enable row level security;
alter table leads        enable row level security;
alter table actions      enable row level security;
alter table errors       enable row level security;
alter table test_runs    enable row level security;
alter table test_results enable row level security;

-- Public, read-only views for the dashboard: demo and test calls only.
-- security_invoker = false: the views run as their owner, so they can read the base
-- tables while anon still can't query those tables directly.
create or replace view public_calls with (security_invoker = false) as
  select id, client_id, started_at, duration_s, channel, intent, route, route_reason, outcome,
         ended_reason, cost_usd, recording_url, transcript, summary, is_demo, is_test
  from calls where is_demo or is_test;

create or replace view public_leads with (security_invoker = false) as
  select l.* from leads l join calls c on c.id = l.call_id where c.is_demo or c.is_test;

create or replace view public_actions with (security_invoker = false) as
  select a.* from actions a join calls c on c.id = a.call_id where c.is_demo or c.is_test;

-- Health panel: counts only, no personal data, so it can include real calls.
create or replace view public_health with (security_invoker = false) as
  select
    (select max(ended_at) from calls where outcome is distinct from 'failed')               as last_successful_call_at,
    (select count(*) from calls where outcome = 'transfer_failed'
       and started_at > now() - interval '7 days')                                         as failed_transfers_7d,
    (select count(*) from errors where created_at > now() - interval '24 hours')           as errors_24h,
    (select count(*) from calls where started_at > now() - interval '7 days')              as calls_7d;

create or replace view public_errors with (security_invoker = false) as
  select id, source, message, created_at from errors order by created_at desc limit 50;

create or replace view public_test_results with (security_invoker = false) as
  select r.id as run_id, r.started_at, r.finished_at, r.passed as run_passed, r.failed as run_failed,
         t.persona, t.passed, t.assertions, t.transcript, t.call_id
  from test_runs r join test_results t on t.run_id = r.id;

revoke all on calls, leads, actions, errors, test_runs, test_results from anon, authenticated;
grant select on public_calls, public_leads, public_actions, public_health, public_errors, public_test_results to anon, authenticated;
