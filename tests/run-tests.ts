// AI caller harness, command-line version. The per-persona logic lives in
// lib/persona-runner.ts and is shared with the dashboard's "Run tests" button.
//
// Usage: npm run test:personas                     all personas
//        npm run test:personas -- --persona price  only personas whose file or name matches
// Needs a payment method on the Vapi account (chat API requirement). Text only: about 15 to 25¢ a persona.

import "dotenv/config";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../lib/config";
import { readState } from "../lib/state";
import { finishRun, isOutOfCredit, loadPersonas, runPersonaSafely, startRun } from "../lib/persona-runner";

const config = loadConfig(process.env.CLIENT_ID ?? "jrco");
const state = readState(config.client_id, config.environment);
const ELLA = state.assistants.ella;
const KEY = process.env.VAPI_PRIVATE_KEY ?? "";
const filter = (() => { const i = process.argv.indexOf("--persona"); return i > 0 ? process.argv[i + 1]?.toLowerCase() : undefined; })();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const db = createClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main(): Promise<void> {
  if (!KEY) throw new Error("VAPI_PRIVATE_KEY is not set");
  if (!ELLA) throw new Error("Ella isn't provisioned (configs/state). Run npm run provision first.");
  const personas = loadPersonas(filter);
  if (!personas.length) throw new Error(`No personas match "${filter}"`);

  let sha: string | null = null;
  try { sha = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* not a git checkout */ }
  const runId = await startRun(db, config.client_id, sha);

  console.log(`Running ${personas.length} persona(s) against ${config.agent.name} (${config.environment})`);
  let cost = 0;
  for (const p of personas) {
    const r = await runPersonaSafely(p, { db, vapiKey: KEY, assistantId: ELLA, runId });
    cost += r.cost;
    if (r.error) {
      console.log(`\nERROR ${p.name}: ${r.error}`);
      if (isOutOfCredit(r)) break;
      continue;
    }
    console.log(`\n${r.passed ? "PASS" : "FAIL"}  ${p.name}  ($${r.cost.toFixed(3)})`);
    for (const c of r.checks) console.log(`   ${c.passed ? "ok  " : "FAIL"} ${c.name}${!c.passed && c.detail ? `  [${c.detail}]` : ""}`);
  }
  const { passed, failed } = await finishRun(db, runId);
  console.log(`\n${passed} passed, ${failed} failed. Vapi cost about $${cost.toFixed(2)}. Results: ${process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? ""}/tests`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`test:personas failed: ${(err as Error).message}`);
  process.exit(1);
});
