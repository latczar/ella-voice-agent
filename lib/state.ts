// Provisioning state: the IDs and numbers of the Vapi resources created for a client
// and environment. Stored in configs/state/<client>.<environment>.json and committed,
// so reruns update the same resources instead of creating duplicates. No secrets here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config";

export interface PhoneNumberState {
  id: string;
  number: string | null; // free Vapi numbers can take a moment to be assigned
}

export interface ProvisionState {
  client_id: string;
  environment: string;
  updated_at: string | null;
  /** Assistant IDs keyed by role: "ella" or a department key. */
  assistants: Record<string, string>;
  /** Tool IDs keyed by tool name. */
  tools: Record<string, string>;
  /** Phone numbers keyed by role: "ella", a department key, or "unanswered_test". */
  phone_numbers: Record<string, PhoneNumberState>;
  /** Knowledge base file IDs keyed by filename (only when kb.mode is "vapi"). */
  kb_files: Record<string, string>;
}

export function statePath(clientId: string, environment: string): string {
  return path.join(REPO_ROOT, "configs", "state", `${clientId}.${environment}.json`);
}

export function readState(clientId: string, environment: string): ProvisionState {
  const file = statePath(clientId, environment);
  if (!existsSync(file)) {
    return { client_id: clientId, environment, updated_at: null, assistants: {}, tools: {}, phone_numbers: {}, kb_files: {} };
  }
  return JSON.parse(readFileSync(file, "utf8")) as ProvisionState;
}

export function writeState(state: ProvisionState): void {
  const file = statePath(state.client_id, state.environment);
  mkdirSync(path.dirname(file), { recursive: true });
  state.updated_at = new Date().toISOString();
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}
