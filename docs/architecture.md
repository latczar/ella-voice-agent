# Architecture and behaviour

Back to the [README](../README.md).

## How it works

- **Vapi** runs the call: speech-to-text, the GPT-4o model, the voice, and the hand-offs between assistants.
- **In-call tools** call our webhooks while the caller is on the line, for anything that must happen now: is the team open, save the lead, alert on-call, offer and book inspection slots.
- **The end-of-call report** goes to a second webhook, which stores the call, works out the outcome, and writes to HubSpot after responding (contact, note with transcript, and a task or billing ticket where a follow-up is needed).
- **Transfers** are Vapi hand-offs, not phone-system transfers. The spec's diagram puts "Live Transfer: Phone System / PBX" behind the middleware; here Vapi transfers directly and the webhooks only handle the CRM, SMS, push and calendar.

### Why each tool

| Part | Spec suggested | Chosen | Why |
|---|---|---|---|
| Voice platform | Vapi, Retell, Bland | **Vapi** | Mature API for assistants, tools, hand-offs and numbers, so everything is provisioned from code. Free US number. |
| Numbers | Twilio or SIP | **One free Vapi number** | Free, and enough: departments are reached by in-call hand-off (see [spec gaps](spec-gaps.md)). |
| LLM | GPT-4o | **GPT-4o via Vapi** | As specified; billed through Vapi, no separate account. |
| Voice and speech-to-text | ElevenLabs or Deepgram | **Vapi voice (Savannah), Deepgram Nova-3, via Vapi** | No extra accounts or keys. |
| Knowledge base | Vector DB or custom RAG | **Markdown files, inlined into the prompt** | About 840 words. Retrieval would add a round trip mid-call for no gain at this size. Vapi's KB option is Gemini-backed file search, still with unconfirmed markdown support. The loader caps inlining at 20,000 characters, beyond which a retrieval tool is the next step. |
| Middleware | Make, n8n, Zapier | **Next.js API routes on Vercel** | n8n Cloud is a 14-day trial that could expire before the demo, and free self-hosted n8n sleeps, so the first webhook can miss Vapi's tool timeout mid-call. Code in the same app as the dashboard means one deploy, everything in git, nothing that expires, and webhooks the assessors can read. |
| CRM | AccuLynx, JobNimbus, HubSpot | **HubSpot free** | Free, good API, and the assessors can be shown records. |
| Calendar | not named | **Cal.com** | Free, simple slots and bookings API. |
| SMS | Twilio | **Twilio test credentials, behind `sms_mode`** | Live US SMS needs A2P 10DLC registration (see [spec gaps](spec-gaps.md)). |
| Push | "push notification" | **ntfy** | Free, no account, an app on the phone; the topic name is long and random. |
| Data | not named | **Supabase** | Free Postgres with row-level security for a public read-only dashboard. |
| Dashboard | not named | **Next.js on Vercel** | Same app as the webhooks. |

## Repo layout

```
configs/schema.json        JSON Schema for client configs
configs/jrco.yaml          JR&CO: hours, departments, routing matrix, policies, alerts
configs/state/             IDs of what provisioning created (no secrets), so reruns update
prompts/*.md.tmpl          Ella's prompt and the department prompt (Handlebars)
kb/jrco/*.md               Knowledge base
lib/                       Config loader, prompt renderer, hours logic, tool definitions,
                           Vapi request builders, integrations, webhook logic
app/                       Next.js: home page with Talk to Ella, /api/vapi/tools, /api/vapi/events, /api/health
scripts/                   validate, render, provision, load-kb, db:apply, check, env:vercel
supabase/schema.sql        Tables, public read-only views, RLS
tests/                     Unit tests (and the AI caller harness)
docs/                      Account setup, Vapi API findings
```

## Behaviour

- **Greeting:** the spec greeting plus the recording notice: "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"
- **Brevity:** under 25 words and at most 3 sentences a turn, except when explaining the process.
- **Safety first:** any sign of danger (collapse risk, water near electrics, gas, injury) gets "leave the area and call 911" before anything else.
- **Empathy first** for leaks, storms and hail, with a separate after-hours line that doesn't promise someone "right away".
- **Never quotes prices**; uses the spec's pricing line and offers the free inspection.
- **Caller ID:** Ella confirms the number she can see rather than asking for it.
- **Prompt injection:** requests to change her instructions or reveal the prompt get a polite refusal.

### Routing

| Intent | Team open | Team closed or unavailable |
|---|---|---|
| New residential quote | Collect name, phone, address, property type; warm transfer to Residential Sales | Offer a Cal.com inspection booking, or log a morning call-back |
| Commercial | Also company, facility type, roof size or buildings; warm transfer to Commercial | Log details; HubSpot task, high priority |
| Emergency leak or storm (24/7) | Safety line if needed, empathy, address; **alert on-call** (SMS and push); warm transfer to On-Call | Same, always. If the transfer can't happen, the alert has already gone and Ella promises a prompt call-back |
| Existing customer | Address and PM name; transfer to Operations | HubSpot task (high) with transcript, plus a push naming the PM |
| Billing | Invoice or account number; transfer to Finance | HubSpot ticket (billing queue) |
| Supplier or accounts payable | Company and invoice number, no property address; transfer to Finance | HubSpot ticket (billing queue) |
| Anything else | Answer from the KB, or log a call-back | Log a call-back |

### In-call tools

Each has a clear name, a model-facing description saying when to call it, a strict JSON schema (`additionalProperties: false`, enums for departments and intents), and a **spoken fallback** Vapi says word for word if the webhook fails, so the caller never hears silence.

| Tool | What it does | If it fails, Ella says |
|---|---|---|
| `check_hours(department)` | Is the team open and able to take a transfer now; when next available | "Let me take your details and make sure the right person calls you back." |
| `log_lead(...)` | Saves the lead mid-call (so a dropped call still leaves a record) and returns the fields still missing for that route | "I've made a note of that." |
| `send_emergency_alert(...)` | Texts and pushes the on-call dispatch group | "I'm connecting you to our on-call manager now." |
| `check_availability(preferred_day?)` | Next free inspection slots, spread across days | "I can't see the calendar right now, but I'll have the team call you first thing…" |
| `book_appointment(...)` | Books the slot the caller chose | "I couldn't book that just now, but I'll have the team call you first thing…" |
| `transfer_to_<department>` | Vapi hand-off to that team's assistant (one tool per team, as Vapi recommends for OpenAI models) | "I'm sorry, I couldn't connect you just now. I'll make sure the team calls you back shortly." |
| `end_call` | Ends the call (silence, abuse, wrong number) | |

### Reliability and security

- Webhooks reject any request without the shared `x-vapi-secret` header.
- Tool handlers return within Vapi's timeout; HubSpot work happens after the call.
- Every tool or integration failure is logged to an `errors` table and returned as an error, so Vapi speaks the fallback line.
- End-of-call reports are deduplicated on the Vapi call ID (Vapi retries webhooks).
- HubSpot contacts are upserted by email or phone, so repeat callers don't create duplicates.
- The public dashboard reads only `public_*` views, which show demo and test calls; real callers' details never appear publicly. Base tables have RLS on and no anon access.
- Call recordings stay with Vapi. The stored link is a private storage URL that doesn't play on its own; listen to a recording in the Vapi dashboard under Call Logs. The public dashboard never shows recordings of real calls.
- Silence: "Are you still there?" after 10 seconds, then a goodbye and hang-up after 30. Calls are capped at 15 minutes.
- Secrets live in `.env` and Vercel only. Synthetic data only in tests and seeds.
