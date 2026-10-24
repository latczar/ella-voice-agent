// Supabase access for the webhooks (service role key, server-side only).
// Every helper is failure-tolerant: a database problem is logged, never thrown at
// Vapi, because a caller on the line matters more than a missing row.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  if (!client) console.warn("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY); nothing will be stored.");
  return client;
}

export interface CallRow {
  id: string;
  client_id: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_s?: number | null;
  channel?: "phone" | "web" | "chat" | "test";
  caller_number?: string | null;
  intent?: string | null;
  route?: string | null;
  route_reason?: string | null;
  outcome?: string | null;
  ended_reason?: string | null;
  cost_usd?: number | null;
  recording_url?: string | null;
  transcript?: string | null;
  summary?: string | null;
  is_demo?: boolean;
  is_test?: boolean;
  report_processed_at?: string | null;
}

export type LeadRow = Record<string, string | boolean | null | undefined> & { call_id: string; client_id: string };

/** Insert or merge a call row. Only the fields given are changed. */
export async function upsertCall(row: CallRow): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
  const { error } = await supabase.from("calls").upsert(clean, { onConflict: "id" });
  if (error) await logError("db:calls", error.message, row.id);
}

/** Merge lead fields into the call's lead. Blank values never overwrite captured ones. */
export async function mergeLead(row: LeadRow): Promise<LeadRow | null> {
  const supabase = db();
  if (!supabase) return null;
  const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const { data, error } = await supabase.from("leads").upsert(clean, { onConflict: "call_id" }).select().single();
  if (error) {
    await logError("db:leads", error.message, row.call_id);
    return null;
  }
  return data as LeadRow;
}

export async function getLead(callId: string): Promise<LeadRow | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase.from("leads").select("*").eq("call_id", callId).maybeSingle();
  return (data as LeadRow) ?? null;
}

export async function getCall(callId: string): Promise<CallRow | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
  return (data as CallRow) ?? null;
}

export type ActionKind = "sms" | "push" | "booking" | "crm_contact" | "crm_task" | "crm_ticket" | "email" | "transfer";

export async function recordAction(callId: string, kind: ActionKind, status: "ok" | "failed" | "skipped", detail: object = {}): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  const { error } = await supabase.from("actions").insert({ call_id: callId, kind, status, detail });
  if (error) console.error(`recordAction failed: ${error.message}`);
}

export async function logError(source: string, message: string, callId?: string | null, detail?: object): Promise<void> {
  console.error(`[${source}] ${message}${callId ? ` (call ${callId})` : ""}`);
  const supabase = db();
  if (!supabase) return;
  const { error } = await supabase.from("errors").insert({ source, message: message.slice(0, 2000), call_id: callId ?? null, detail: detail ?? null });
  if (error) console.error(`logError insert failed: ${error.message}`);
}
