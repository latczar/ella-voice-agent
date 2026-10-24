// Runs the persona tests from the dashboard. Each run spends real Vapi credit and writes test
// records to HubSpot and Cal.com, so every request needs the admin passcode
// (DASHBOARD_ADMIN_PASSCODE), only one run may be open at a time, and runs are spaced by a
// cooldown. Vercel functions have a time limit, so the browser steps through the run:
//   { action: "start", passcode }                    -> { runId, personas: [{ file, name }] }
//   { action: "persona", passcode, runId, file }     -> one persona's result
//   { action: "finish", passcode, runId }            -> { passed, failed }

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import { db } from "@/lib/server/db";
import { ESTIMATED_COST_PER_PERSONA_USD, finishRun, loadPersonas, runPersonaSafely, startRun } from "@/lib/persona-runner";

export const dynamic = "force-dynamic";
// Past persona conversations took 10 to 30 seconds; 60 s is within every Vercel plan.
export const maxDuration = 60;

/** A run left open longer than this is treated as abandoned (the browser tab was closed). */
const RUN_TIMEOUT_MS = 15 * 60_000;
/** Minimum gap between the end of one run and the start of the next. */
const COOLDOWN_MS = 10 * 60_000;

type Body = { action?: string; passcode?: string; runId?: string; file?: string };

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

function passcodeMatches(given: string): boolean {
  // Compare fixed-length hashes so the check takes the same time whatever was typed.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(process.env.DASHBOARD_ADMIN_PASSCODE ?? "").digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail(400, "Request body must be JSON.");
  }

  if (!process.env.DASHBOARD_ADMIN_PASSCODE) return fail(503, "Running tests from the dashboard is switched off: DASHBOARD_ADMIN_PASSCODE isn't set on the server.");
  if (!body.passcode || !passcodeMatches(body.passcode)) {
    await new Promise((r) => setTimeout(r, 1000)); // slows down guessing
    return fail(401, "That passcode isn't right.");
  }

  const supabase = db();
  const vapiKey = process.env.VAPI_PRIVATE_KEY;
  if (!supabase) return fail(503, "Supabase isn't configured on the server, so results can't be stored.");
  if (!vapiKey) return fail(503, "VAPI_PRIVATE_KEY isn't set on the server, so the test caller can't reach Vapi.");
  const config = loadConfig(process.env.CLIENT_ID ?? "jrco");
  const assistantId = readState(config.client_id, config.environment).assistants.ella;
  if (!assistantId) return fail(503, `${config.agent.name} isn't provisioned for ${config.environment} (configs/state).`);

  const personas = loadPersonas();

  if (body.action === "start") {
    const { data: open } = await supabase.from("test_runs").select("id, started_at").is("finished_at", null).order("started_at", { ascending: false });
    for (const run of open ?? []) {
      const age = Date.now() - Date.parse(run.started_at);
      if (age < RUN_TIMEOUT_MS) return fail(409, `A test run is already in progress (started ${minutes(age)} min ago). Wait for it to finish, then try again.`);
      await finishRun(supabase, run.id); // abandoned: close it so it stops blocking
    }
    const { data: last } = await supabase.from("test_runs").select("finished_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle();
    const since = last?.finished_at ? Date.now() - Date.parse(last.finished_at) : Infinity;
    if (since < COOLDOWN_MS) return fail(429, `Tests last finished ${minutes(since)} min ago. To keep Vapi costs down, the next run can start in ${minutes(COOLDOWN_MS - since)} min.`);

    const runId = await startRun(supabase, config.client_id, process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null);
    return NextResponse.json({
      ok: true,
      runId,
      personas: personas.map((p) => ({ file: p.file, name: p.name })),
      estimatedCostUsd: Number((personas.length * ESTIMATED_COST_PER_PERSONA_USD).toFixed(2)),
    });
  }

  if (!body.runId) return fail(400, "runId is missing.");
  const { data: run } = await supabase.from("test_runs").select("id, started_at, finished_at").eq("id", body.runId).maybeSingle();
  if (!run) return fail(404, "That test run doesn't exist.");
  if (run.finished_at) return fail(409, "That test run has already finished.");
  if (Date.now() - Date.parse(run.started_at) > RUN_TIMEOUT_MS) {
    await finishRun(supabase, run.id);
    return fail(410, "That test run timed out and has been closed. Start a new one.");
  }

  if (body.action === "persona") {
    const persona = personas.find((p) => p.file === body.file);
    if (!persona) return fail(400, `Unknown persona "${body.file ?? ""}".`);
    const { count } = await supabase.from("test_results").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("persona", persona.name);
    if (count) return fail(409, `${persona.name} has already run in this test run.`);
    const result = await runPersonaSafely(persona, { db: supabase, vapiKey, assistantId, runId: run.id });
    return NextResponse.json({ ok: true, result });
  }

  if (body.action === "finish") {
    const totals = await finishRun(supabase, run.id);
    return NextResponse.json({ ok: true, ...totals });
  }

  return fail(400, `Unknown action "${body.action ?? ""}". Use start, persona or finish.`);
}
