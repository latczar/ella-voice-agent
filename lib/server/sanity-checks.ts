// Free sanity checks for the dashboard's Tests page: everything that can be checked without
// spending Vapi credit. Reads files, the database and Vapi's read-only API (no calls or chats),
// and sends two unsigned requests to our own webhooks to prove they're refused.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfigError, loadConfig, type ClientConfig } from "../config";
import { SECRET_HEADER } from "../constants";
import { lintPersona } from "../persona-lint";
import { loadPersonas } from "../persona-runner";
import { renderDepartmentPrompt, renderSystemPrompt } from "../prompt";
import { readState } from "../state";

export interface SanityCheck { group: string; name: string; passed: boolean; detail?: string }

const TIMEOUT_MS = 8000;

interface VapiAssistant { id: string; name?: string; model?: { messages?: { role: string; content: string }[]; toolIds?: string[] } }
interface VapiPhoneNumber { id: string; number?: string; status?: string; assistantId?: string }

async function vapiGet<T>(key: string, path: string): Promise<T | null> {
  const res = await fetch(`https://api.vapi.ai${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Vapi returned ${res.status}`);
  return (await res.json()) as T;
}

/** Where two prompts first differ, as a short readable hint. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const around = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 40));
  return `differs at character ${i}: live ${around(a)}, repo ${around(b)}. Run npm run provision to update Vapi.`;
}

export async function runSanityChecks(opts: { clientId: string; baseUrl: string; vapiKey?: string; db: SupabaseClient | null }): Promise<SanityCheck[]> {
  const checks: SanityCheck[] = [];
  const add = (group: string, name: string, passed: boolean, detail?: string) => checks.push({ group, name, passed, detail });

  // ---- Config -----------------------------------------------------------------
  let c: ClientConfig;
  try {
    c = loadConfig(opts.clientId);
    add("Config", "Client config passes the schema and cross-checks", true, `configs/${opts.clientId}.yaml`);
  } catch (err) {
    add("Config", "Client config passes the schema and cross-checks", false, err instanceof ConfigError ? err.message : (err as Error).message);
    return checks; // nothing else can be checked without a config
  }
  try {
    add("Config", "Ella's prompt renders from the template and knowledge base", renderSystemPrompt(c).length > 1000);
  } catch (err) {
    add("Config", "Ella's prompt renders from the template and knowledge base", false, (err as Error).message);
  }

  // ---- Scenario files ---------------------------------------------------------
  const personas = loadPersonas();
  add("Scenarios", `${personas.length} scenario files found`, personas.length > 0);
  for (const p of personas) {
    const problems = lintPersona(p, c);
    add("Scenarios", p.name, problems.length === 0, problems.length ? problems.join("; ") : "sound: real tools and fields, synthetic details, right time, patterns match their examples");
  }

  // ---- Live assistant on Vapi (read-only) -------------------------------------
  const state = readState(c.client_id, c.environment);
  const ellaId = state.assistants.ella;
  if (!opts.vapiKey) {
    add("Vapi", "Vapi key configured on the server", false, "VAPI_PRIVATE_KEY isn't set");
  } else if (!ellaId) {
    add("Vapi", `${c.agent.name} is provisioned`, false, "no assistant ID in configs/state; run npm run provision");
  } else {
    try {
      const ella = await vapiGet<VapiAssistant>(opts.vapiKey, `/assistant/${ellaId}`);
      add("Vapi", `${c.agent.name} exists on Vapi (${c.environment})`, Boolean(ella), ella ? ella.name : "not found; run npm run provision");
      if (ella) {
        const live = ella.model?.messages?.find((m) => m.role === "system")?.content?.trim() ?? "";
        const repo = renderSystemPrompt(c).trim();
        add("Vapi", `${c.agent.name}'s live prompt matches the repo`, live === repo, live === repo ? `${repo.length} characters` : firstDifference(live, repo));
        const liveTools = new Set(ella.model?.toolIds ?? []);
        const missing = Object.entries(state.tools).filter(([, id]) => !liveTools.has(id)).map(([name]) => name);
        add("Vapi", `All ${Object.keys(state.tools).length} tools are attached`, missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : undefined);
      }
      for (const [key, dept] of Object.entries(c.departments)) {
        const id = state.assistants[key];
        const a = id ? await vapiGet<VapiAssistant>(opts.vapiKey, `/assistant/${id}`) : null;
        const live = a?.model?.messages?.find((m) => m.role === "system")?.content?.trim();
        const ok = Boolean(a) && live === renderDepartmentPrompt(c, key).trim();
        add("Vapi", `${dept.name} stand-in (${dept.persona.name}) exists and is up to date`, ok, !a ? "not found; run npm run provision" : ok ? undefined : "prompt differs from the repo; run npm run provision");
      }
      const phone = state.phone_numbers.ella;
      if (phone?.id) {
        const n = await vapiGet<VapiPhoneNumber>(opts.vapiKey, `/phone-number/${phone.id}`);
        const ok = Boolean(n) && n!.assistantId === ellaId && (!n!.status || n!.status === "active");
        const number = n?.number ?? phone.number;
        add("Vapi", `Phone number${number ? ` ${number}` : ""} answers as ${c.agent.name}`, ok, !n ? "not found" : `status ${n.status ?? "unknown"}${n.assistantId === ellaId ? "" : ", assigned to a different assistant"}`);
      }
    } catch (err) {
      add("Vapi", "Vapi's API answers", false, (err as Error).message);
    }
  }

  // ---- Webhooks ---------------------------------------------------------------
  for (const route of ["tools", "events"]) {
    try {
      const res = await fetch(`${opts.baseUrl}/api/vapi/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SECRET_HEADER]: "wrong-secret" },
        body: JSON.stringify({ message: { type: "sanity-check" } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      add("Webhooks", `/api/vapi/${route} refuses a request without the right secret`, res.status === 401, `returned ${res.status}`);
    } catch (err) {
      add("Webhooks", `/api/vapi/${route} refuses a request without the right secret`, false, (err as Error).message);
    }
  }

  // ---- Data and integrations --------------------------------------------------
  if (!opts.db) {
    add("Data", "Supabase reachable", false, "not configured on the server");
  } else {
    const started = Date.now();
    const { error } = await opts.db.from("calls").select("id", { head: true, count: "estimated" }).limit(1).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    add("Data", "Supabase reachable", !error, error ? "query failed" : `answered in ${Date.now() - started} ms`);
  }
  const configured = (...names: string[]) => names.every((n) => Boolean(process.env[n]));
  add("Data", "Vapi webhook secret set", configured("VAPI_WEBHOOK_SECRET"));
  add("Data", "HubSpot token set", configured("HUBSPOT_PRIVATE_APP_TOKEN"));
  add("Data", "Cal.com key and event type set", configured("CALCOM_API_KEY", "CALCOM_EVENT_TYPE_ID"));
  add("Data", "ntfy topic set (emergency push alerts)", configured("NTFY_TOPIC"));

  return checks;
}
