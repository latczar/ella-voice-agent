// Builds Vapi request bodies (assistants, tools, phone number) from a client config.
// Pure functions: scripts/provision.ts sends them. Shapes checked against Vapi's
// OpenAPI spec (api.vapi.ai/api-json), October 2026.

import type { ClientConfig } from "./config";
import { departmentFirstMessage, renderDepartmentPrompt, renderSystemPrompt } from "./prompt";
import { toolSpecs, transferToolName, type ToolSpec } from "./tools";

export interface ServerTarget {
  /** Public base URL of the Next.js app, e.g. https://ella-jrco.vercel.app */
  baseUrl: string;
  /** Shared secret Vapi sends on every request; the webhooks reject anything without it. */
  secret: string;
}

import { SECRET_HEADER } from "./constants";

export { SECRET_HEADER };

/** Vapi names are capped at 40 characters, so long labels are shortened to fit the suffix. */
export function resourceName(c: ClientConfig, label: string): string {
  const suffix = ` (${c.client_id}, ${c.environment === "staging" ? "staging" : "live"})`;
  const room = 40 - suffix.length;
  return (label.length > room ? `${label.slice(0, room - 1).trimEnd()}…` : label) + suffix;
}

/** Query string that tells the webhooks which client config and environment a request is for. */
function scope(c: ClientConfig): string {
  return `client=${encodeURIComponent(c.client_id)}&env=${encodeURIComponent(c.environment)}`;
}

function server(c: ClientConfig, target: ServerTarget, route: string, timeoutSeconds = 20) {
  return {
    url: `${target.baseUrl.replace(/\/$/, "")}/api/vapi/${route}?${scope(c)}`,
    headers: { [SECRET_HEADER]: target.secret },
    timeoutSeconds,
  };
}

// ---- Tools ---------------------------------------------------------------

export function functionToolBody(c: ClientConfig, spec: ToolSpec, target: ServerTarget) {
  const messages: object[] = [];
  if (spec.saysWhileRunning !== undefined) messages.push({ type: "request-start", content: spec.saysWhileRunning, blocking: false });
  messages.push({ type: "request-failed", content: spec.saysOnFailure });
  return {
    type: "function",
    async: false,
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
    server: server(c, target, "tools", spec.timeoutSeconds),
    messages,
  };
}

export function functionToolBodies(c: ClientConfig, target: ServerTarget) {
  return toolSpecs(c).map((spec) => ({ name: spec.name, body: functionToolBody(c, spec, target) }));
}

/** In-call hand-off to a stand-in department assistant (transfer_to: assistant). */
export function handoffToolBody(c: ClientConfig, departmentKey: string, assistantId: string) {
  const d = c.departments[departmentKey];
  return {
    type: "handoff",
    function: {
      name: transferToolName(departmentKey),
      description: `Transfer the caller to ${d.name}. Only after check_hours says they can take the call, and after log_lead.`,
      parameters: { type: "object", properties: {}, required: [] },
    },
    destinations: [
      {
        type: "assistant",
        assistantId,
        description: `${d.name} at ${c.business.short_name}.`,
        // Warm: the team sees the whole conversation. Cold: they start fresh.
        contextEngineeringPlan: { type: d.transfer_type === "warm" ? "all" : "none" },
      },
    ],
    messages: [{ type: "request-failed", content: "I'm sorry, I couldn't connect you just now. I'll make sure the team calls you back shortly." }],
  };
}

/**
 * Phone transfer for departments with a real number (transfer_to: "+1..."). Not used by
 * JR&CO in this build. warm-transfer-experimental is the mode Vapi documents as detecting
 * an unanswered or busy line and handing the caller back to the assistant.
 */
export function phoneTransferToolBody(c: ClientConfig) {
  const destinations = Object.entries(c.departments)
    .filter(([, d]) => d.transfer_to !== "assistant")
    .map(([, d]) => ({
      type: "number",
      number: d.transfer_to,
      description: `${d.name} at ${c.business.short_name}.`,
      message: `Connecting you to ${d.name} now.`,
      transferPlan:
        d.transfer_type === "warm"
          ? {
              mode: "warm-transfer-experimental",
              summaryPlan: { enabled: true },
              fallbackPlan: {
                message: "I'm sorry, nobody could pick up just now. I've passed on your details and the team will call you back shortly.",
                endCallEnabled: false,
              },
            }
          : { mode: "blind-transfer" },
    }));
  return destinations.length ? { type: "transferCall", destinations } : null;
}

export function endCallToolBody() {
  return { type: "endCall" };
}

// ---- Assistants ----------------------------------------------------------

function voice(c: ClientConfig, voiceId?: string) {
  // A department stand-in can have its own voice (so "Mike" doesn't sound like Ella); the version applies to Ella's voice only.
  if (voiceId && voiceId !== c.voice.voice_id) return { provider: c.voice.provider, voiceId };
  return { provider: c.voice.provider, voiceId: c.voice.voice_id, ...(c.voice.voice_version ? { version: c.voice.voice_version } : {}) };
}

function transcriber(c: ClientConfig) {
  return { provider: c.voice.transcriber.provider, model: c.voice.transcriber.model, language: c.locale.language };
}

/**
 * Silence handling. Vapi has no assistant-level silence timeout any more, so two hooks:
 * a nudge after 10 seconds, then a goodbye and hang-up after the configured timeout.
 */
function silenceHooks(c: ClientConfig) {
  return [
    {
      on: "customer.speech.timeout",
      options: { timeoutSeconds: 10, triggerMaxCount: 1, triggerResetMode: "onUserSpeech" },
      do: [{ type: "say", exact: "Are you still there?" }],
    },
    {
      on: "customer.speech.timeout",
      options: { timeoutSeconds: c.call.silence_timeout_seconds, triggerMaxCount: 1 },
      do: [
        { type: "say", exact: `I can't hear anything, so I'll end the call now. Please call ${c.business.spoken_name} back any time.` },
        { type: "tool", tool: { type: "endCall" } },
      ],
    },
  ];
}

export function ellaAssistantBody(c: ClientConfig, target: ServerTarget, toolIds: string[]) {
  return {
    name: resourceName(c, c.agent.name),
    firstMessage: c.agent.first_message,
    // Ella speaks as soon as the call connects: the closest Vapi gets to "answer on the first ring".
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: c.voice.model.provider,
      model: c.voice.model.model,
      temperature: c.voice.model.temperature,
      maxTokens: c.voice.model.max_tokens ?? 250,
      messages: [{ role: "system", content: renderSystemPrompt(c) }],
      toolIds,
    },
    voice: voice(c),
    transcriber: transcriber(c),
    backgroundSound: "off",
    maxDurationSeconds: c.call.max_duration_seconds,
    endCallMessage: c.call.end_call_message,
    hooks: silenceHooks(c),
    server: server(c, target, "events"),
    serverMessages: ["end-of-call-report", "status-update", "hang"],
    analysisPlan: { summaryPlan: { enabled: true } },
    metadata: { client_id: c.client_id, environment: c.environment, role: "ella" },
  };
}

export function departmentAssistantBody(c: ClientConfig, departmentKey: string, target: ServerTarget, endCallToolId: string) {
  const d = c.departments[departmentKey];
  return {
    name: resourceName(c, `${d.persona.name}, ${d.name}`),
    firstMessage: departmentFirstMessage(c, departmentKey),
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: c.voice.model.provider,
      model: c.voice.model.model,
      temperature: c.voice.model.temperature,
      maxTokens: 200,
      messages: [{ role: "system", content: renderDepartmentPrompt(c, departmentKey) }],
      toolIds: [endCallToolId],
    },
    voice: voice(c, c.departments[departmentKey].persona.voice_id),
    transcriber: transcriber(c),
    backgroundSound: "off",
    maxDurationSeconds: 300,
    endCallMessage: "Thanks for calling. Take care.",
    // Same events webhook: the end-of-call report for a handed-off call is still Ella's call.
    server: server(c, target, "events"),
    serverMessages: ["end-of-call-report"],
    metadata: { client_id: c.client_id, environment: c.environment, role: "department", department: departmentKey },
  };
}

// ---- Phone number --------------------------------------------------------

export function phoneNumberBody(c: ClientConfig, assistantId: string) {
  return {
    provider: "vapi",
    name: resourceName(c, c.agent.name),
    ...(c.agent.phone.area_code ? { numberDesiredAreaCode: c.agent.phone.area_code } : {}),
    assistantId,
  };
}
