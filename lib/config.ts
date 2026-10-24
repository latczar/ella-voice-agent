// Loads and validates a client config (configs/<client>.yaml).
// Used by the scripts and by the Next.js webhooks, so it must not touch the network.

import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../configs/schema.json";

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeekSchedule = Record<Day, string>; // "HH:MM-HH:MM" | "closed" | "24h"

export type LeadField =
  | "full_name" | "phone" | "email" | "property_address" | "property_type" | "caller_need"
  | "pm_name" | "invoice_or_account_number" | "company_name" | "facility_type" | "roof_size_or_buildings";

export interface Department {
  name: string;
  transfer_to: "assistant" | string; // "assistant" = in-call hand-off; otherwise an E.164 number
  transfer_type: "warm" | "cold";
  hours: WeekSchedule;
  persona: { name: string; greeting: string };
  after_hours_fallback: string[];
}

export interface Intent {
  id: string;
  label: string;
  caller_need: string;
  department: string | null;
  emergency?: boolean;
  required_fields: LeadField[];
  in_hours: string;
  after_hours: string;
}

export interface ClientConfig {
  client_id: string;
  environment: "staging" | "live";
  business: { name: string; short_name: string; spoken_name: string; description: string; website?: string | null };
  agent: { name: string; role: string; tone: string[]; first_message: string; phone: { number: string; area_code?: string } };
  locale: { language: string; country: string; timezone: string; emergency_number: string };
  voice: {
    provider: string;
    voice_id: string;
    voice_version?: 1 | 2;
    transcriber: { provider: string; model: string; language: string };
    model: { provider: string; model: string; temperature: number; max_tokens?: number };
  };
  call: { answer_on_first_ring: boolean; silence_timeout_seconds: number; max_duration_seconds: number; end_call_message: string };
  hours: Record<string, WeekSchedule>;
  departments: Record<string, Department>;
  intents: Intent[];
  alerts: {
    sms_mode: "test" | "push" | "live";
    dispatch_sms_group: string[];
    twilio_test_from?: string;
    push: { provider: "ntfy"; topic_env: string; emergency_always: boolean };
  };
  crm: { type: "hubspot"; lead_source: string; billing_queue: "ticket" | "task"; follow_up: "task"; emergency: "task_high_priority" };
  calendar: { provider: "cal_com"; event_type_id_env: string; lookahead_days: number; slots_to_offer: number };
  kb: { path: string; mode: "prompt" | "vapi" };
  policies: {
    pricing: string;
    brevity: { max_words: number; max_sentences: number; exception?: string };
    empathy: { in_hours: string; after_hours: string };
    safety_line: string;
    consent: { recording: string; sms_opt_in: string };
    timelines: string;
    non_english: string;
  };
}

export class ConfigError extends Error {
  constructor(public readonly file: string, public readonly problems: string[]) {
    super(`${file} is not valid:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

// Scripts run from the repo root (npm run ...), and Vercel runs the app from the project root,
// so the working directory is the repo root in both cases.
export const REPO_ROOT = process.cwd();

export function configPath(clientId: string): string {
  return path.join(REPO_ROOT, "configs", `${clientId}.yaml`);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

/** Parse, schema-check and cross-check a config. Throws ConfigError listing every problem found. */
export function loadConfig(clientId: string): ClientConfig {
  const file = configPath(clientId);
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(file, "utf8"), { merge: true });
  } catch (err) {
    throw new ConfigError(file, [`could not read or parse YAML: ${(err as Error).message}`]);
  }

  if (!validateSchema(raw)) {
    const problems = (validateSchema.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
    throw new ConfigError(file, problems);
  }

  const config = raw as unknown as ClientConfig; // shape guaranteed by the schema check above
  const problems = crossCheck(config);
  if (problems.length) throw new ConfigError(file, problems);
  return config;
}

/** Rules the JSON Schema can't express. */
export function crossCheck(c: ClientConfig): string[] {
  const problems: string[] = [];

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: c.locale.timezone });
  } catch {
    problems.push(`locale.timezone "${c.locale.timezone}" is not a valid IANA timezone`);
  }

  if (!c.agent.first_message.includes(c.policies.consent.recording)) {
    problems.push("agent.first_message must include policies.consent.recording, so every call starts with the recording notice");
  }
  if (!c.agent.first_message.includes(c.agent.name)) {
    problems.push("agent.first_message should introduce the agent by name");
  }

  const ids = new Set<string>();
  for (const intent of c.intents) {
    if (ids.has(intent.id)) problems.push(`intents: duplicate id "${intent.id}"`);
    ids.add(intent.id);
    if (intent.department !== null && !(intent.department in c.departments)) {
      problems.push(`intents.${intent.id}.department "${intent.department}" is not a key in departments`);
    }
  }
  if (!c.intents.some((i) => i.emergency)) {
    problems.push("intents: at least one intent must be marked emergency: true");
  }
  for (const intent of c.intents.filter((i) => i.emergency)) {
    if (!intent.department) problems.push(`intents.${intent.id}: an emergency intent needs a department to transfer to`);
  }

  for (const [key, dept] of Object.entries(c.departments)) {
    for (const [day, span] of Object.entries(dept.hours)) {
      if (span === "closed" || span === "24h") continue;
      const [open, close] = span.split("-");
      if (open >= close) problems.push(`departments.${key}.hours.${day}: "${span}" closes before it opens`);
    }
  }

  const routed = new Set(c.intents.map((i) => i.department).filter(Boolean));
  for (const key of Object.keys(c.departments)) {
    if (!routed.has(key)) problems.push(`departments.${key} is never routed to by any intent`);
  }

  return problems;
}

/** How each department is reached: an in-call hand-off or a phone transfer. */
export function transferTargets(c: ClientConfig): { key: string; via: "handoff" | "phone"; number: string | null }[] {
  return Object.entries(c.departments).map(([key, d]) =>
    d.transfer_to === "assistant" ? { key, via: "handoff" as const, number: null } : { key, via: "phone" as const, number: d.transfer_to },
  );
}
