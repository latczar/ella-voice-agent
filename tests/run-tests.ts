// AI caller harness: a second model plays each persona in tests/personas/*.yaml and talks
// to the staging Ella by text through Vapi's chat API (same prompt and tools as on calls).
// Each conversation is checked against the brief's rules and written to test_runs /
// test_results, which the dashboard shows at /tests.
//
// Usage: npm run test:personas                     all personas
//        npm run test:personas -- --persona price  only personas whose file or name matches
// Needs a payment method on the Vapi account (chat API requirement). Text only: a few cents a run.

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import YAML from "yaml";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, REPO_ROOT } from "../lib/config";
import { readState } from "../lib/state";

interface Persona {
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

interface Assertion { name: string; passed: boolean; detail?: string }

const config = loadConfig(process.env.CLIENT_ID ?? "jrco");
const state = readState(config.client_id, config.environment);
const ELLA = state.assistants.ella;
const KEY = process.env.VAPI_PRIVATE_KEY ?? "";
const filter = (() => { const i = process.argv.indexOf("--persona"); return i > 0 ? process.argv[i + 1]?.toLowerCase() : undefined; })();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const db = createClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// ---- Vapi chat ----------------------------------------------------------------

interface ChatMessage { role: string; content?: string; tool_calls?: { function: { name: string } }[] }
interface ChatResponse { id: string; output: ChatMessage[]; cost?: number }

async function chat(body: Record<string, unknown>): Promise<ChatResponse> {
  const res = await fetch("https://api.vapi.ai/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 402 ? " (add a payment method in the Vapi dashboard: Billing & Payment)" : "";
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
function sentences(s: string): number { return s.split(/[.!?]+(?=\s|$)/).filter((x) => x.trim()).length; }

async function runPersona(p: Persona, runId: string): Promise<{ passed: boolean; cost: number }> {
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
    const ella = await chat({
      assistantId: ELLA,
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
    const caller = await chat({
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
  await db.from("test_results").insert({ run_id: runId, persona: p.name, passed, assertions: checks, transcript: all, call_id: callIds[0] ?? ellaChatId ?? null });

  console.log(`\n${passed ? "PASS" : "FAIL"}  ${p.name}  ($${cost.toFixed(3)})`);
  for (const c of checks) console.log(`   ${c.passed ? "ok  " : "FAIL"} ${c.name}${!c.passed && c.detail ? `  [${c.detail}]` : ""}`);
  return { passed, cost };
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("VAPI_PRIVATE_KEY is not set");
  if (!ELLA) throw new Error("Ella isn't provisioned (configs/state). Run npm run provision first.");
  const dir = path.join(REPO_ROOT, "tests", "personas");
  const personas: Persona[] = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => ({ file: f, ...(YAML.parse(readFileSync(path.join(dir, f), "utf8")) as Omit<Persona, "file">) }))
    .filter((p) => !filter || p.file.toLowerCase().includes(filter) || p.name.toLowerCase().includes(filter));
  if (!personas.length) throw new Error(`No personas match "${filter}"`);

  let sha: string | null = null;
  try { sha = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* not a git checkout */ }
  const { data: run, error } = await db.from("test_runs").insert({ client_id: config.client_id, git_sha: sha }).select("id").single();
  if (error) throw new Error(`Couldn't create test run: ${error.message}`);

  console.log(`Running ${personas.length} persona(s) against ${config.agent.name} (${config.environment})`);
  let passed = 0, failed = 0, cost = 0;
  for (const p of personas) {
    try {
      const r = await runPersona(p, run.id);
      r.passed ? passed++ : failed++;
      cost += r.cost;
    } catch (err) {
      failed++;
      console.log(`\nERROR ${p.name}: ${(err as Error).message}`);
      await db.from("test_results").insert({ run_id: run.id, persona: p.name, passed: false, assertions: [{ name: "Conversation ran", passed: false, detail: (err as Error).message.slice(0, 300) }] });
      if (/402/.test((err as Error).message)) break;
    }
  }
  await db.from("test_runs").update({ finished_at: new Date().toISOString(), passed, failed }).eq("id", run.id);
  console.log(`\n${passed} passed, ${failed} failed. Vapi cost about $${cost.toFixed(2)}. Results: ${process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? ""}/tests`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`test:personas failed: ${(err as Error).message}`);
  process.exit(1);
});
