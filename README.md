# Ella: AI voice receptionist for JR&CO Roofing

Ella answers every call to JR&CO Roofing, a fictional US residential and commercial roofer, 24/7. She answers questions about roofing systems and the process, captures the caller's details, and routes the call: a warm transfer to the right team, a free inspection booking, an emergency alert to the on-call team, or a logged call-back.

This repo is not a one-off agent. It is a **config-driven, tested build process**, and Ella is its first client. A new client is a new YAML file plus a knowledge-base folder; the prompts, tools, Vapi resources and webhooks are all generated or driven from that config. See [SKILL.md](SKILL.md) to build one for another client.

| | |
|---|---|
| Call Ella | **+1 (213) 464-0087** (US number) |
| Dashboard and "Talk to Ella" in the browser | https://ella-voice-agent.vercel.app |
| Demo video | _link to come (Lat to add)_ |
| Status page | _optional, not set up_ |

All data in this project is synthetic. Please don't give Ella real personal details.

---

## How it works

```mermaid
flowchart LR
  caller([Caller: phone or browser]) --> vapi[Vapi: Ella assistant<br/>GPT-4o, Deepgram, Vapi voice]
  vapi -- "hand-off (warm or cold)" --> dept[Stand-in department assistants<br/>Residential, Commercial, On-call,<br/>Operations, Finance]
  vapi -- "in-call tools<br/>(check_hours, log_lead,<br/>send_emergency_alert,<br/>check_availability, book_appointment)" --> tools[/Vercel: /api/vapi/tools/]
  vapi -- "end-of-call report" --> events[/Vercel: /api/vapi/events/]
  tools --> supa[(Supabase)]
  tools --> ntfy[ntfy push]
  tools --> twilio[Twilio SMS<br/>test mode]
  tools --> cal[Cal.com]
  events --> supa
  events --> hubspot[HubSpot CRM]
  supa --> dash[Dashboard<br/>same Next.js app]
```

- **Vapi** runs the call: speech-to-text, the GPT-4o model, the voice, and the hand-offs between assistants.
- **In-call tools** call our webhooks while the caller is on the line, for anything that must happen now: is the team open, save the lead, alert on-call, offer and book inspection slots.
- **The end-of-call report** goes to a second webhook, which stores the call, works out the outcome, and writes to HubSpot after responding (contact, note with transcript, and a task or billing ticket where a follow-up is needed).
- **Transfers** are Vapi hand-offs, not phone-system transfers. The spec's diagram puts "Live Transfer: Phone System / PBX" behind the middleware; here Vapi transfers directly and the webhooks only handle the CRM, SMS, push and calendar.

### Why each tool

| Part | Spec suggested | Chosen | Why |
|---|---|---|---|
| Voice platform | Vapi, Retell, Bland | **Vapi** | Mature API for assistants, tools, hand-offs and numbers, so everything is provisioned from code. Free US number. |
| Numbers | Twilio or SIP | **One free Vapi number** | Free, and enough: departments are reached by in-call hand-off (see gaps). |
| LLM | GPT-4o | **GPT-4o via Vapi** | As specified; billed through Vapi, no separate account. |
| Voice and speech-to-text | ElevenLabs or Deepgram | **Vapi voice (Savannah), Deepgram Nova-3, via Vapi** | No extra accounts or keys. |
| Knowledge base | Vector DB or custom RAG | **Markdown files, inlined into the prompt** | About 840 words. Retrieval would add a round trip mid-call for no gain at this size. Vapi's KB option is Gemini-backed file search, still with unconfirmed markdown support. The loader caps inlining at 20,000 characters, beyond which a retrieval tool is the next step. |
| Middleware | Make, n8n, Zapier | **Next.js API routes on Vercel** | n8n Cloud is a 14-day trial that could expire before the demo, and free self-hosted n8n sleeps, so the first webhook can miss Vapi's tool timeout mid-call. Code in the same app as the dashboard means one deploy, everything in git, nothing that expires, and webhooks the assessors can read. |
| CRM | AccuLynx, JobNimbus, HubSpot | **HubSpot free** | Free, good API, and the assessors can be shown records. |
| Calendar | not named | **Cal.com** | Free, simple slots and bookings API. |
| SMS | Twilio | **Twilio test credentials, behind `sms_mode`** | Live US SMS needs A2P 10DLC registration (see gaps). |
| Push | "push notification" | **ntfy** | Free, no account, an app on the phone; the topic name is long and random. |
| Data | not named | **Supabase** | Free Postgres with row-level security for a public read-only dashboard. |
| Dashboard | not named | **Next.js on Vercel** | Same app as the webhooks. |

---

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

## Setup

You need Node 20+, and accounts for Vapi, Supabase, Vercel, HubSpot, Cal.com and Twilio (test credentials only), plus the ntfy app. [docs/account-setup.md](docs/account-setup.md) has click-by-click steps.

```bash
npm install
cp .env.example .env          # then fill it in; each line says where the value comes from
npm run validate              # config: schema, cross-checks, KB, prompts render
npm run db:apply              # create tables and views in Supabase (idempotent)
npm run check                 # each integration, with synthetic data
npm run provision             # create or update Ella, departments, tools, number in Vapi (idempotent)
npm run env:vercel            # writes .env.vercel to paste into Vercel's environment variables
npm run test:unit
```

`npm run provision -- --dry-run` prints every request without a Vapi account. `npm run render` writes the finished prompts to `build/` for review.

### Environment variables

See [.env.example](.env.example). Only the webhook secret, public Vapi key, Supabase URL and keys, HubSpot, Cal.com, Twilio test and ntfy values go to Vercel. The Vapi private key and database password stay local.

---

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
- Silence: "Are you still there?" after 10 seconds, then a goodbye and hang-up after 30. Calls are capped at 15 minutes.
- Secrets live in `.env` and Vercel only. Synthetic data only in tests and seeds.

---

## Tests

| Command | What it checks | Cost |
|---|---|---|
| `npm run test:unit` | Business-hours logic: open, closed, next opening, 24/7 on-call, closing time exclusive | Free |
| `npm run test:api` | Both webhooks with fake Vapi payloads: secret header enforced, every tool's happy and error paths, batches, lead merging and phone normalisation, Cal.com slot offers, end-of-call storage, outcome from the hand-off, retried reports ignored. Test rows are flagged and deleted afterwards. `TEST_ALERTS=1` also exercises the emergency alert (sends a real push) | Free |
| `npm run test:ui` | Every dashboard page renders with its key content; unknown calls are a 404; the live app reports every integration configured | Free |
| `npm test` | All three of the above | Free |
| `npm run test:personas` | AI caller simulations (below) | A few cents per persona |

Unit, API and UI tests run against `TEST_BASE_URL` (default: the deployed app). The UI tests caught a real deployment bug: the dashboard pages weren't shipped with the provisioning state, so the live site showed "Not provisioned".

### AI caller simulations

`npm run test:personas` runs each file in [tests/personas/](tests/personas/): a second model (GPT-4o mini) plays the caller and talks to the staging Ella **by text through Vapi's chat API**, so Ella runs with exactly the same prompt and tools as on a phone call, for cents rather than voice minutes. Test conversations pass variables that the webhooks honour only on test calls: `is_test` (flags the rows), `simulate_time` (to test after-hours routing at any time of day) and `simulate_unanswered` (to test the unanswered-transfer fallback).

Each run checks, as relevant to the persona: the intent logged, the tools called (and not called, e.g. no transfer after hours), the lead fields captured (read back from Supabase), alerts or bookings recorded, the call-back flag, empathy and the safety line, and always **no price figures** and **every turn under 25 words and at most 3 sentences** (process explanations excepted). Results and transcripts are written to Supabase and shown on the dashboard's **Tests** page.

The six core personas from the brief are written: residential in hours, emergency leak in hours (with danger), emergency storm after hours, price pusher, residential after hours, transfer not answered. Vapi also has a built-in simulations API; we used our own runner so the checks can read our database (leads, alerts, bookings) and the results appear on our dashboard.

---

## Assumptions and spec gaps

| Gap in the spec | What we did |
|---|---|
| Brevity: "2 to 3 sentences" in one place, "under 25 words" in another | Both: under 25 words and at most 3 sentences, except multi-step process explanations |
| No business hours, timezone, location or transfer numbers | US Central (America/Chicago). Sales, Commercial, Operations: Mon to Fri 7am to 6pm, Sat 8am to noon. Finance: Mon to Fri 8am to 5pm. On-call: 24/7. All in `configs/jrco.yaml` |
| Locale not stated | Built for the US: US English, US numbers, 911 |
| How "JR&CO" should be pronounced | "J.R. and Co" for the voice; written form unchanged |
| "On-Call Manager", "On-Call Dispatch team" and "24/7 On-Call Dispatch" used for one role | One on-call manager to transfer to, plus a dispatch group that gets alerts |
| Emergencies: the prompt says 24/7 warm transfer, the routing table says SMS after hours | Both, 24/7: always alert, always try the transfer |
| Emergency SMS only mentioned for after hours | Sent in hours too, alongside the transfer |
| Capture name, phone, address and property type before any transfer, but "prioritise" emergencies | Emergency minimum is the address; the phone comes from caller ID; the rest can follow |
| The prompt's transfer list misses Commercial and Existing Customer, and says "Sales" where the table says "Residential Sales" | All five departments are routed |
| Residential transfer "Cold/Warm"; commercial transfer type not stated | Warm for all; configurable per department |
| "Facility info" undefined; no company name field | Added company name, facility type, and rough roof size or number of buildings |
| "Billing & Accounts Payable" also covers suppliers chasing payment | Added a supplier intent: company and invoice number, no property address |
| "Lead Qualifier" has no qualification criteria | Qualified means the route's required fields plus intent and urgency; `log_lead` reports what's missing |
| "General project timelines" not given beyond the 24 to 48 hour proposal | Ella states only the proposal timeline |
| Empathy example ("get someone out… right away") overpromises after hours | Separate after-hours wording |
| No recording consent or SMS opt-in wording | Recording notice in the greeting; Ella asks before any text to the caller |
| No unanswered-transfer fallback | Ella stays on the line, apologises, logs a call-back; the emergency alert has already gone. With hand-offs there is no "no answer", so `check_hours` can report a team as unavailable (`simulate_unanswered`) to exercise the path |
| No emergency safety guidance | Safety line with 911, before anything else |
| Silence, hang-ups, non-English callers, call length not covered | Silence prompt then hang-up at 30 seconds; leads saved mid-call so hang-ups still leave a record; non-English callers get an apology and a call-back promise; 15-minute cap |
| CRM "e.g." only; "CRM billing queue" undefined | HubSpot free; the billing queue is a ticket in the default Support pipeline (falls back to a task) |
| "Push notification" has no channel | ntfy |
| "Notify assigned Project Manager" but no PM directory | A push naming the PM, plus a high-priority HubSpot task |
| Commercial after hours: "high-priority email" | No email service in this build; a high-priority HubSpot task instead (HubSpot can email the owner) |
| Live SMS | Not done. US A2P 10DLC registration needs a paid Twilio account and brand and campaign approval; unregistered texts are blocked (error 30034). `sms_mode: push` (used here) delivers the dispatch text to a phone via ntfy. `sms_mode: test` (Twilio test credentials) is built but **not exercised**: Twilio's sign-up phone verification wouldn't accept the developer's numbers, so no test credentials could be issued. `npm run check` skips Twilio when its keys are absent |
| Brevity rule vs the spec's own lines | Two allowed exceptions to the 25-word rule: the emergency safety-line turn (leave the area, call 911) and the spec's 23-word pricing line when followed by the inspection offer. The persona checks allow both |
| Test calls make real Cal.com bookings | On test calls (`is_test`), `book_appointment` swaps the attendee email for a throwaway public inbox (`lib/server/tool-handlers.ts`), so booking checks run end to end without emailing anyone |
| Middleware suggested (n8n etc.) | Webhooks in code, for the reasons above |
| Vector DB or custom RAG suggested | Markdown in the prompt, for the reasons above |
| Live transfer via the phone system / PBX | Vapi hand-offs. Vapi's free plan has one number and free numbers can't dial out, so each department is a stand-in assistant that answers as that team. A department can be set to a real number in the config; provisioning then builds a phone transfer with an unanswered-call fallback (`warm-transfer-experimental`) |

## Cost per call

Vapi bills per minute and passes provider costs through at cost. Every call's actual total is stored in `calls.cost_usd` from Vapi's end-of-call report and shown on the dashboard.

| Part | Rate (USD per minute) | Notes |
|---|---|---|
| Vapi platform fee | $0.05 | Flat, published |
| Speech-to-text (Deepgram Nova-3) | about $0.01 | Via Vapi |
| Voice (Vapi Savannah) | about $0.02 | Via Vapi |
| GPT-4o | about $0.04 to $0.07 | The prompt plus inlined KB is about 16,600 characters (around 4,000 tokens, 5,500 with tool schemas), resent on every turn; four to five turns a minute |
| Telephony (free Vapi US number, inbound) | about $0.01 | |
| **Total** | **about $0.13 to $0.16 per minute** | A typical 3-minute call is **about $0.40 to $0.50** |

Hand-offs to department assistants stay on the same Vapi call, so there is one bill per call, not two.

**Measured so far:** one persona conversation through Vapi's chat API cost $0.26, counting both Ella and the AI caller (chat is billed per message, not per minute, so this is not a phone-call figure). _Replace with the average of real phone calls once there are some: `select avg(cost_usd), avg(duration_s) from calls where channel = 'phone' and not is_demo and not is_test;`_

**What live SMS would add:** a US Twilio text is about $0.008 to $0.01 per segment plus carrier fees, so an emergency alert to a three-person dispatch group is about 3 to 5 cents. A2P 10DLC registration adds one-off brand and campaign fees and a small monthly campaign fee. ntfy push, used here, is free.

## What was prioritised, and what was cut

The brief asks for a working core over polish, so the tiers were built in order and each was working before the next began.

**Prioritised**
- **The working core first:** Ella on a real number and in the browser, the config file and schema, the prompt templates, the in-call tools, the webhooks, and an idempotent provisioning script. Everything is created from code; nothing was clicked together in a dashboard.
- **Safety and routing over breadth:** emergencies (safety line, 24/7 alert plus transfer), never quoting prices, and the unanswered-transfer fallback were built and tested before anything cosmetic.
- **Tests that read real outcomes:** the persona harness checks the database (leads, alerts, bookings), not just the transcript, and its results show on the dashboard.
- **Spec gaps written down** as they were found, rather than left until the end.

**Cut or reduced**
- **Twilio SMS:** Twilio's sign-up phone verification would not accept the developer's numbers, so no test credentials could be issued. The `test` SMS mode is built but not exercised; alerts go by ntfy push (`sms_mode: push`). Live SMS was never planned (A2P 10DLC, see gaps).
- **Personas 07 to 14** (commercial, existing customer, billing, supplier, refuser, unclear address, off-topic, prompt injection): the behaviour is in the prompt and routing, but only the six core personas have automated runs. Each run costs Vapi credit, so runs were kept to what proved the core.
- **Real phone transfers:** stand-in department assistants via Vapi hand-offs instead, as the free number cannot dial out. A real number can be set per department in the config.
- **Email:** no email service; high-priority HubSpot tasks instead.
- **BetterStack monitor and status page:** optional (Could tier). `/api/health` is ready for one.

## Adding a new client

See [SKILL.md](SKILL.md).
