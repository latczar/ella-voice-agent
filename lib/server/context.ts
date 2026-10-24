// Works out who and what a Vapi webhook request is about: which client config,
// which call, the caller's number, and whether it's a test.

import { loadConfig, type ClientConfig } from "../config";

export interface CallContext {
  config: ClientConfig;
  callId: string;
  callerNumber: string | null;
  channel: "phone" | "web" | "chat" | "test";
  isTest: boolean;
  /** Departments to treat as "nobody available" on this call (tests and demos of the fallback). */
  simulateUnanswered: string[];
  /** Test calls only: the time check_hours should treat as "now" (to test after-hours routing). */
  simulatedNow: Date | null;
}

const configs = new Map<string, ClientConfig>();

/** Client config named by the webhook URL (?client=jrco&env=staging), cached per instance. */
export function configFromUrl(url: string): ClientConfig {
  const clientId = new URL(url).searchParams.get("client") ?? process.env.CLIENT_ID ?? "jrco";
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(clientId)) throw new Error(`Invalid client "${clientId}"`);
  if (!configs.has(clientId)) configs.set(clientId, loadConfig(clientId));
  return configs.get(clientId)!;
}

// Loosely typed: Vapi's payloads are large and we read only a few fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VapiMessage = Record<string, any>;

export function callContext(config: ClientConfig, message: VapiMessage): CallContext {
  const call = message.call ?? {};
  const chat = message.chat ?? {};
  // Calls carry variables on call.assistantOverrides; chats have used several places.
  const vars = {
    ...(call.assistantOverrides?.variableValues ?? {}),
    ...(chat.metadata?.variableValues ?? {}),
    ...(chat.assistantOverrides?.variableValues ?? {}),
    ...(message.assistant?.variableValues ?? {}),
    ...(message.variableValues ?? {}),
  };
  const callType: string = call.type ?? "";
  const channel: CallContext["channel"] = message.chat ? "chat" : callType === "webCall" ? "web" : "phone";
  // Every chat turn is a new chat object; tests pass a session ID so one conversation is one call record.
  const testSession = typeof vars.test_session === "string" && /^[\w-]{8,64}$/.test(vars.test_session) ? vars.test_session : null;
  const isTest = vars.is_test === true || vars.is_test === "true";

  const simulated = [vars.simulate_unanswered, process.env.SIMULATE_UNANSWERED]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .flatMap((v) => v.split(",").map((s) => s.trim()));

  return {
    config,
    callId: (isTest && testSession) || (call.id ?? chat.id ?? `unknown-${Date.now()}`),
    callerNumber: message.customer?.number ?? call.customer?.number ?? null,
    channel: isTest && channel === "phone" ? "test" : channel,
    isTest,
    simulateUnanswered: simulated,
    simulatedNow: isTest && typeof vars.simulate_time === "string" && !Number.isNaN(Date.parse(vars.simulate_time)) ? new Date(vars.simulate_time) : null,
  };
}
