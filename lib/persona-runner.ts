// The persona test harness, shared by the CLI (tests/run-tests.ts) and the dashboard's
// "Run tests" button (app/api/tests/run). A second model plays each persona in
// tests/personas/*.yaml and talks to the staging Ella by text through Vapi's chat API (same
// prompt and tools as on calls). Each conversation is checked against the brief's rules and
// written to test_runs / test_results, which the dashboard shows at /tests.
//
// One persona per function call, so a caller with a time limit (a Vercel function) can step
// through them one request at a time.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REPO_ROOT } from "./config";

export interface Persona {
  file: string;
  name: string;
  time?: string;
  simulate_unanswered?: string;
  opening: string;
  caller: string;
  max_turns?: number;
  expect: {
    intent?: string;
    tools?: string[];
    tools_any?: string[];
    tools_not?: string[];
    lead_fields?: string[];
    actions?: string[];
    empathy?: boolean;
    safety_line?: boolean;
    no_prices?: boolean;
    mentions?: string[];
    callback?: boolean;
  };
}

export interface Assertion { name: string; passed: boolean; detail?: string }

export interface PersonaResult { persona: string; file: string; passed: boolean; cost: number; checks: Assertion[]; error?: string }

export interface HarnessContext {
  db: SupabaseClient;
  vapiKey: string;
  /** The staging Ella's Vapi assistant ID. */
  assistantId: string;
  runId: string;
}

/** Rough Vapi cost of one persona conversation (both sides), from past runs. Shown before a paid run. */
export const ESTIMATED_COST_PER_PERSONA_USD = 0.13;

/** Every persona file, sorted, optionally filtered by file name or persona name. */
export function loadPersonas(filter?: string): Persona[] {
  const dir = path.join(REPO_ROOT, "tests", "personas");
  const f = filter?.toLowerCase();
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => ({ file: name, ...(YAML.parse(readFileSync(path.join(dir, name), "utf8")) as Omit<Persona, "file">) }))
    .filter((p) => !f || p.file.toLowerCase().includes(f) || p.name.toLowerCase().includes(f));
}

// ---- Vapi chat ----------------------------------------------------------------

interface ChatMessage { role: string; content?: string; tool_calls?: { function: { name: string } }[] }
interface ChatResponse { id: string; output: ChatMessage[]; cost?: number }

async function chat(key: string, body: Record<string, unknown>): Promise<ChatResponse> {
  const res = await fetch("https://api.vapi.ai/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 402 ? " (add a payment method or credit in the Vapi dashboard: Billing & Payment)" : "";
    throw new Error(`Vapi chat returned ${res.status}${hint}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as ChatResponse;
}

/** The caller: a transient assistant that only ever speaks as the persona. */
function callerAssistant(p: Persona) {
  return {
    name: "Test caller",
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [{
        role: "system",
        content: `You are role-playing a phone caller to a roofing company's receptionist, Ella. Stay in character.
${p.caller}
Rules: reply with only what the caller says, one or two short sentences. Answer what Ella asks.
Use only made-up details given above. When Ella has transferred you, booked you, promised a call-back,
or the conversation is clearly finished, say a short goodbye and add the token [END].`,
      }],
    },
  };
}

// ---- Checks -------------------------------------------------------------------

const PRICE = /\$\s?\d|\b\d[\d,.]*\s?(dollars|bucks|k\b)|\bper (square|sq\.?) ?(foot|feet|ft)\b.*\d|\d.*\bper (square|sq)/i;
const EMPATHY = /\b(sorry|understand|that sounds|stressful|frustrating|i hear you)\b/i;
const PROCESS = /(inspection|proposal|scope|insurance|installation|warranty)/gi;

function words(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }
// Initials such as "J.R." (the spoken business name) are not sentence ends, nor is "Co." mid-sentence.
function sentences(s: string): number { return s.replace(/\b(?:[A-Z]\.)+/g, "X").replace(/\bCo\.(?=\s+[a-z])/g, "Co").split(/[.!?]+(?=\s|$)/).filter((x) => x.trim()).length; }

/** Runs one persona conversation, checks it and writes its test_results row. Throws on a Vapi or setup failure. */
export async function runPersona(p: Persona, ctx: HarnessContext): Promise<PersonaResult> {
  const { db } = ctx;
  const startedAt = new Date();
  // test_session ties every chat turn of this conversation to one call record in Supabase.
  const variableValues: Record<string, string> = { is_test: "true", test_session: `test-${crypto.randomUUID()}` };
  if (p.time) variableValues.simulate_time = p.time;
  if (p.simulate_unanswered) variableValues.simulate_unanswered = p.simulate_unanswered;

  const transcript: string[] = [];
  const ellaTurns: string[] = [];
  const toolsCalled: string[] = [];
  let cost = 0;
  let ellaChatId: string | undefined;
  let callerChatId: string | undefined;
  let callerLine = p.opening;
  const maxTurns = p.max_turns ?? 10;

  for (let turn = 0; turn < maxTurns; turn++) {
    transcript.push(`User: ${callerLine.replace("[END]", "").trim()}`);
    const ella = await chat(ctx.vapiKey, {
      assistantId: ctx.assistantId,
      input: callerLine.replace("[END]", "").trim(),
      assistantOverrides: { variableValues },
      ...(ellaChatId ? { previousChatId: ellaChatId } : {}),
    });
    ellaChatId = ella.id;
    cost += ella.cost ?? 0;

    let handedOff = false;
    for (const m of ella.output ?? []) {
      for (const t of m.tool_calls ?? []) {
        toolsCalled.push(t.function.name);
        if (/^transfer_to_|^end_call$|^endCall$/.test(t.function.name)) handedOff = true;
      }
      if (m.role === "assistant" && m.content?.trim()) {
        ellaTurns.push(m.content.trim());
        transcript.push(`AI: ${m.content.trim()}`);
      }
    }
    if (handedOff || callerLine.includes("[END]")) break;

    const lastElla = ellaTurns.at(-1) ?? "";
    const caller = await chat(ctx.vapiKey, {
      assistant: callerAssistant(p),
      ...(callerChatId ? { previousChatId: callerChatId } : {}),
      input: `Ella said: "${lastElla}"`,
    });
    callerChatId = caller.id;
    cost += caller.cost ?? 0;
    callerLine = caller.output?.find((m) => m.role === "assistant")?.content?.trim() || "[END]";
    if (callerLine === "[END]") break;
  }

  // Webhook side effects for this conversation: the test call row(s) created since we started.
  await new Promise((r) => setTimeout(r, 1500));
  const { data: calls } = await db.from("calls").select("id").eq("id", variableValues.test_session);
  const callIds = (calls ?? []).map((c) => c.id as string);
  const { data: leads } = callIds.length ? await db.from("leads").select("*").in("call_id", callIds) : { data: [] };
  const { data: actions } = callIds.length ? await db.from("actions").select("kind, status").in("call_id", callIds) : { data: [] };
  const lead = (leads ?? [])[0] as Record<string, unknown> | undefined;
  const okActions = new Set((actions ?? []).filter((a) => a.status === "ok").map((a) => a.kind as string));

  const e = p.expect;
  const all = transcript.join("\n");
  const ellaText = ellaTurns.join("\n");
  const checks: Assertion[] = [];
  const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail });

  if (e.intent) check(`Intent logged as ${e.intent}`, lead?.intent === e.intent, `logged: ${lead?.intent ?? "nothing"}`);
  for (const t of e.tools ?? []) check(`Called ${t}`, toolsCalled.includes(t), `tools called: ${toolsCalled.join(", ") || "none"}`);
  if (e.tools_any?.length) check(`Called one of ${e.tools_any.join(" / ")}`, e.tools_any.some((t) => toolsCalled.includes(t)), `tools called: ${toolsCalled.join(", ") || "none"}`);
  for (const t of e.tools_not ?? []) check(`Did not call ${t}`, !toolsCalled.includes(t));
  for (const f of e.lead_fields ?? []) check(`Captured ${f.replace(/_/g, " ")}`, Boolean(lead?.[f]), lead?.[f] ? String(lead[f]) : "missing");
  for (const a of e.actions ?? []) check(`Action recorded: ${a}`, okActions.has(a), `recorded: ${[...okActions].join(", ") || "none"}`);
  if (e.callback) check("Call-back requested in the lead", lead?.callback_requested === true);
  if (e.empathy) check("Empathy shown", EMPATHY.test(ellaText));
  if (e.safety_line) check("Safety line given (leave the area, 911)", /911/.test(ellaText) && /(leave|get (everyone )?out|get away|stay out)/i.test(ellaText));
  for (const m of e.mentions ?? []) check(`Mentions "${m}"`, ellaText.toLowerCase().includes(m.toLowerCase()));
  // Always: no prices, brevity.
  const priceHit = ellaTurns.find((t) => PRICE.test(t));
  check("No price figures", !priceHit, priceHit ? `"${priceHit.slice(0, 120)}"` : undefined);
  // Exceptions: multi-step process explanations, the safety-line turn, and the spec's own pricing line (23 words).
  const long = ellaTurns.filter((t) => (words(t) >= 25 || sentences(t) > 3) && (t.match(PROCESS)?.length ?? 0) < 2 && !/911|zero-obligation/i.test(t));
  check(`Every turn under 25 words and at most 3 sentences`, long.length === 0, long.length ? `${long.length} long turn(s), e.g. "${long[0].slice(0, 120)}…"` : `${ellaTurns.length} turns checked`);

  // Chats have no end-of-call report, so record what this conversation really cost (both sides) and its transcript.
  if (callIds.length) await db.from("calls").update({ cost_usd: Number(cost.toFixed(4)), transcript: all, started_at: startedAt.toISOString(), ended_at: new Date().toISOString() }).eq("id", callIds[0]);

  const passed = checks.every((c) => c.passed);
  await db.from("test_results").insert({ run_id: ctx.runId, persona: p.name, passed, assertions: checks, transcript: all, call_id: callIds[0] ?? ellaChatId ?? null });
  return { persona: p.name, file: p.file, passed, cost, checks };
}

/** Runs a persona and never throws: a failure is recorded as a failed result with the reason. */
export async function runPersonaSafely(p: Persona, ctx: HarnessContext): Promise<PersonaResult> {
  try {
    return await runPersona(p, ctx);
  } catch (err) {
    const message = (err as Error).message;
    const checks = [{ name: "Conversation ran", passed: false, detail: message.slice(0, 300) }];
    await ctx.db.from("test_results").insert({ run_id: ctx.runId, persona: p.name, passed: false, assertions: checks });
    return { persona: p.name, file: p.file, passed: false, cost: 0, checks, error: message };
  }
}

/** True when a failure means later personas can't run either (no Vapi credit). */
export function isOutOfCredit(r: PersonaResult): boolean {
  return Boolean(r.error && /\b402\b/.test(r.error));
}

export async function startRun(db: SupabaseClient, clientId: string, gitSha: string | null): Promise<string> {
  const { data, error } = await db.from("test_runs").insert({ client_id: clientId, git_sha: gitSha }).select("id").single();
  if (error) throw new Error(`Couldn't create test run: ${error.message}`);
  return data.id as string;
}

/** Closes a run, counting its stored results. */
export async function finishRun(db: SupabaseClient, runId: string): Promise<{ passed: number; failed: number }> {
  const { data } = await db.from("test_results").select("passed").eq("run_id", runId);
  const passed = (data ?? []).filter((r) => r.passed).length;
  const failed = (data ?? []).length - passed;
  await db.from("test_runs").update({ finished_at: new Date().toISOString(), passed, failed }).eq("id", runId);
  return { passed, failed };
}
