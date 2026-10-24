// Dashboard data: read-only, through the public_* views with the anon key, so the
// dashboard can only ever see what those views expose (see supabase/schema.sql).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig, type ClientConfig } from "./config";
import { readState } from "./state";

let anon: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (anon !== undefined) return anon;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  anon = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return anon;
}

export function config(): ClientConfig {
  return loadConfig(process.env.CLIENT_ID ?? "jrco");
}

export function siteInfo() {
  const c = config();
  const state = readState(c.client_id, c.environment);
  return {
    businessName: c.business.name,
    agentName: c.agent.name,
    number: state.phone_numbers.ella?.number ?? null,
    assistantId: state.assistants.ella ?? null,
    timezone: c.locale.timezone,
  };
}

export interface PublicCall {
  id: string;
  started_at: string | null;
  duration_s: number | null;
  channel: string | null;
  intent: string | null;
  route: string | null;
  route_reason: string | null;
  outcome: string | null;
  ended_reason: string | null;
  cost_usd: number | null;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  is_demo: boolean;
  is_test: boolean;
  redacted: boolean;
}

export interface PublicLead {
  call_id: string;
  intent: string | null;
  caller_need: string | null;
  property_type: string | null;
  urgency: string | null;
  callback_requested: boolean | null;
  created_at: string;
  visible: boolean;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  property_address: string | null;
  company_name: string | null;
  facility_type: string | null;
  roof_size_or_buildings: string | null;
  pm_name: string | null;
  invoice_or_account_number: string | null;
  summary: string | null;
}

export interface Health {
  last_successful_call_at: string | null;
  failed_transfers_7d: number;
  errors_24h: number;
  calls_7d: number;
}

export interface TestResultRow {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  run_passed: number;
  run_failed: number;
  persona: string;
  passed: boolean;
  assertions: { name: string; passed: boolean; detail?: string }[];
  transcript: string | null;
  call_id: string | null;
}

async function select<T>(view: string, build: (q: ReturnType<SupabaseClient["from"]>) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const db = client();
  if (!db) return [];
  const { data, error } = await build(db.from(view));
  if (error) {
    console.error(`dashboard: ${view}: ${error.message}`);
    return [];
  }
  return (data as T[]) ?? [];
}

export const getCalls = (limit = 100) =>
  select<PublicCall>("public_calls", (q) => q.select("*").order("started_at", { ascending: false, nullsFirst: false }).limit(limit));

export async function getCall(id: string): Promise<PublicCall | null> {
  return (await select<PublicCall>("public_calls", (q) => q.select("*").eq("id", id).limit(1)))[0] ?? null;
}

export const getLeads = (limit = 200) =>
  select<PublicLead>("public_leads", (q) => q.select("*").order("created_at", { ascending: false }).limit(limit));

export async function getLead(callId: string): Promise<PublicLead | null> {
  return (await select<PublicLead>("public_leads", (q) => q.select("*").eq("call_id", callId).limit(1)))[0] ?? null;
}

export const getActions = (callId: string) =>
  select<{ id: string; kind: string; status: string; created_at: string }>("public_actions", (q) =>
    q.select("*").eq("call_id", callId).order("created_at", { ascending: true }),
  );

export async function getHealth(): Promise<Health | null> {
  return (await select<Health>("public_health", (q) => q.select("*").limit(1)))[0] ?? null;
}

export const getErrors = (limit = 8) =>
  select<{ id: string; source: string; message: string; created_at: string }>("public_errors", (q) => q.select("*").limit(limit));

/** Results of the most recent test run only. */
export async function getLatestTestRun(): Promise<TestResultRow[]> {
  const latest = await select<{ run_id: string }>("public_test_results", (q) => q.select("run_id").order("started_at", { ascending: false }).limit(1));
  if (!latest[0]) return [];
  return select<TestResultRow>("public_test_results", (q) => q.select("*").eq("run_id", latest[0].run_id).order("persona"));
}

// ---- Formatting ------------------------------------------------------------

export function formatUsNumber(e164: string | null): string {
  const d = e164?.replace(/\D/g, "") ?? "";
  return d.length === 11 && d.startsWith("1") ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : e164 ?? "";
}

export function formatWhen(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDuration(s: number | null): string {
  if (s == null) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatCost(usd: number | null): string {
  return usd == null ? "—" : `$${usd.toFixed(2)}`;
}

export function intentLabel(c: ClientConfig, id: string | null): string {
  if (!id) return "Unknown";
  return c.intents.find((i) => i.id === id)?.label ?? id;
}

export function departmentName(c: ClientConfig, key: string | null): string {
  if (!key) return "—";
  return c.departments[key]?.name ?? key;
}

export const OUTCOMES: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  transferred: { label: "Transferred", tone: "ok" },
  booked: { label: "Booked", tone: "ok" },
  lead_captured: { label: "Lead captured", tone: "info" },
  callback: { label: "Call-back", tone: "info" },
  sms_sent: { label: "Alert sent", tone: "warn" },
  transfer_failed: { label: "Transfer failed", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  no_action: { label: "No action", tone: "neutral" },
};
