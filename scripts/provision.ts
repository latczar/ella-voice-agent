// Creates or updates everything in Vapi for one client and environment:
// the function tools, the department assistants, their hand-off tools, Ella, and Ella's number.
//
// Idempotent: IDs are kept in configs/state/<client>.<environment>.json. On a rerun each
// resource is updated in place. If the state file is missing, resources are matched by
// name (assistants, phone number) or server URL (tools) before anything new is created.
//
// Usage:
//   npm run provision -- [client_id]            create or update in Vapi
//   npm run provision -- [client_id] --dry-run  print what would be sent; no Vapi account needed

import "dotenv/config";
import { loadConfig, transferTargets, type ClientConfig } from "../lib/config";
import { readState, statePath, writeState, type ProvisionState } from "../lib/state";
import { VapiClient } from "../lib/vapi";
import {
  departmentAssistantBody,
  ellaAssistantBody,
  endCallToolBody,
  functionToolBodies,
  handoffToolBody,
  phoneNumberBody,
  phoneTransferToolBody,
  resourceName,
  type ServerTarget,
} from "../lib/vapi-resources";
import { transferToolName } from "../lib/tools";

interface VapiResource {
  id: string;
  name?: string;
  type?: string;
  function?: { name?: string };
  server?: { url?: string };
}
interface VapiPhoneNumber extends VapiResource {
  number?: string;
  status?: string;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const clientId = args.find((a) => !a.startsWith("--")) ?? process.env.CLIENT_ID ?? "jrco";

function serverTarget(): ServerTarget {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (dryRun) return { baseUrl: baseUrl || "https://example.vercel.app", secret: secret ? "(set)" : "(not set)" };
  if (!baseUrl) throw new Error("PUBLIC_BASE_URL is not set. Deploy the app to Vercel first and put its URL in .env.");
  if (!secret) throw new Error("VAPI_WEBHOOK_SECRET is not set (see .env.example).");
  return { baseUrl, secret };
}

/** Update the resource we know about, else adopt one that matches, else create. */
async function upsert<T extends VapiResource>(
  vapi: VapiClient,
  kind: "assistant" | "tool" | "phone-number",
  knownId: string | undefined,
  body: Record<string, unknown>,
  matches: (r: T) => boolean,
  label: string,
): Promise<T> {
  let id = knownId;
  if (id && !dryRun && !(await vapi.get<T>(`/${kind}/${id}`))) {
    console.log(`  ${label}: recorded ID ${id} no longer exists in Vapi; looking for a match`);
    id = undefined;
  }
  if (!id) id = (await vapi.list<T>(`/${kind}?limit=1000`)).find(matches)?.id;

  // Fields Vapi only accepts on create.
  const updateBody = kind === "phone-number" ? omit(body, ["numberDesiredAreaCode"]) : body;
  if (id) {
    const updated = await vapi.update<T>(`/${kind}/${id}`, updateBody);
    console.log(`  updated  ${label}`);
    return updated;
  }
  const created = await vapi.create<T>(`/${kind}`, body);
  console.log(`  created  ${label}`);
  return created;
}

function omit(body: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => !keys.includes(k)));
}

async function provision(c: ClientConfig, vapi: VapiClient, state: ProvisionState, target: ServerTarget): Promise<void> {
  // 1. Function tools (check_hours, log_lead, ...). Matched on name plus our server URL,
  //    which includes ?client=&env=, so staging and live never adopt each other's tools.
  console.log("Tools");
  for (const { name, body } of functionToolBodies(c, target)) {
    const tool = await upsert<VapiResource>(
      vapi, "tool", state.tools[name], body,
      (t) => t.type === "function" && t.function?.name === name && t.server?.url === body.server.url,
      name,
    );
    state.tools[name] = tool.id;
  }
  const endCall = await upsert<VapiResource>(vapi, "tool", state.tools.end_call, endCallToolBody(), (t) => t.type === "endCall", "end_call");
  state.tools.end_call = endCall.id;

  // 2. Department assistants, then the hand-off tools that point at them.
  console.log("Departments");
  for (const t of transferTargets(c)) {
    if (t.via !== "handoff") continue;
    const body = departmentAssistantBody(c, t.key, target, endCall.id);
    const assistant = await upsert<VapiResource>(vapi, "assistant", state.assistants[t.key], body, (a) => a.name === body.name, body.name);
    state.assistants[t.key] = assistant.id;

    const toolName = transferToolName(t.key);
    const handoff = await upsert<VapiResource>(
      vapi, "tool", state.tools[toolName], handoffToolBody(c, t.key, assistant.id),
      (x) => x.type === "handoff" && x.function?.name === toolName && JSON.stringify(x).includes(assistant.id),
      toolName,
    );
    state.tools[toolName] = handoff.id;
  }
  const phoneTransfer = phoneTransferToolBody(c);
  if (phoneTransfer) {
    const tool = await upsert<VapiResource>(vapi, "tool", state.tools.transfer_call, phoneTransfer, () => false, "transfer_call (phone)");
    state.tools.transfer_call = tool.id;
  }

  // 3. Ella, with every tool attached.
  console.log(c.agent.name);
  const ellaBody = ellaAssistantBody(c, target, Object.values(state.tools));
  const ella = await upsert<VapiResource>(vapi, "assistant", state.assistants.ella, ellaBody, (a) => a.name === ellaBody.name, ellaBody.name);
  state.assistants.ella = ella.id;

  // 4. Ella's phone number.
  console.log("Phone number");
  if (c.agent.phone.number === "auto") {
    const body = phoneNumberBody(c, ella.id);
    const phone = await upsert<VapiPhoneNumber>(
      vapi, "phone-number", state.phone_numbers.ella?.id, body, (p) => p.name === body.name, body.name,
    );
    state.phone_numbers.ella = { id: phone.id, number: phone.number ?? state.phone_numbers.ella?.number ?? null };
    if (!dryRun && phone.status && phone.status !== "active") {
      console.log(`  number status is "${phone.status}"; free numbers can take a few minutes to activate. Rerun to record it.`);
    }
  } else {
    console.log(`  ${c.agent.phone.number} is managed outside Vapi's free numbers; attach it to assistant ${ella.id} yourself.`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig(clientId);
  const target = serverTarget();
  const vapi = new VapiClient({ dryRun });
  const state = readState(config.client_id, config.environment);

  console.log(`Provisioning ${config.business.name} (${config.environment})${dryRun ? " [dry run]" : ""}`);
  console.log(`Webhooks: ${target.baseUrl}/api/vapi/...\n`);

  try {
    await provision(config, vapi, state, target);
  } finally {
    // Save whatever was created, even on failure, so a rerun updates rather than duplicates.
    if (!dryRun) writeState(state);
  }

  const number = state.phone_numbers.ella?.number;
  console.log(`\nDone.${dryRun ? " Nothing was sent (dry run)." : ` State saved to ${statePath(config.client_id, config.environment)}`}`);
  if (!dryRun) {
    console.log(`  ${config.agent.name}: assistant ${state.assistants.ella}`);
    console.log(`  Call ${config.agent.name} on: ${number ?? "(number still activating; rerun shortly)"}`);
  }
}

main().catch((err) => {
  console.error(`\nProvisioning failed: ${(err as Error).message}`);
  process.exit(1);
});
