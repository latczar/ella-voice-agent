# Vapi: findings that shaped the build

Checked against Vapi's docs and OpenAPI spec (api.vapi.ai/api-json) on 24 October 2026. These feed the README's decisions and spec-gaps sections.

| Finding | Effect on the build |
|---|---|
| The pay-as-you-go plan includes **one** free number. Free numbers are US only and **inbound only** (no outbound calls). | Transfers can't be phone-to-phone between free numbers. Departments are stand-in assistants reached by an **in-call hand-off** (`handoff` tool), one tool per department (`transfer_to_<department>`), as Vapi recommends for OpenAI models. |
| Hand-offs work straight to saved assistants (`assistantId`), with `contextEngineeringPlan` deciding what the next assistant sees. | No squad needed. Warm transfer passes the whole conversation (`all`); cold passes nothing (`none`). Hand-offs also work in browser calls, so "Talk to Ella" can demo a transfer. |
| `warm-transfer-experimental` is the only phone transfer mode documented to detect an unanswered or busy line and hand back to the assistant (`fallbackPlan`, `endCallEnabled: false`). | Used if a department is given a real number (`transfer_to: "+1..."`). Not exercised by JR&CO. |
| Voices Paige and Hana are retired. Active US female v2 voices include Clara, Emma, Layla and Savannah. | Ella uses Savannah, voice version 2. |
| No assistant-level silence timeout any more. | Two `customer.speech.timeout` hooks: "Are you still there?" after 10 seconds, then a goodbye and `endCall` after the configured timeout. |
| `server` has no `secret` field. It takes `url`, `headers`, `credentialId` and `timeoutSeconds`. | Every tool and assistant server sends a static `x-vapi-secret` header; the webhooks reject requests without it. |
| Tool list endpoints can't filter by name. | Provisioning keeps IDs in `configs/state/`, and matches on name or server URL (which carries `?client=&env=`) if the state file is lost. |
| `request-failed` tool messages are spoken exactly as written. | Every tool has a spoken fallback, so a failed webhook never leaves the caller in silence. |
| Vapi's knowledge base uses a `query` tool backed by Gemini file search; markdown support isn't confirmed. | KB is inlined into the prompt (about 1,400 tokens). |
| Chat API: `POST /chat` with `assistantId` and `input`; continue with `previousChatId`. | Basis for the cheap text-only test harness. |
| Not confirmed in the docs: whether hand-offs carry the end-of-call report as one call. | To check on the first real call. |
