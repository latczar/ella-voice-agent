# Setup and tests

Back to the [README](../README.md).

## Setup

You need Node 20+, and accounts for Vapi, Supabase, Vercel, HubSpot, Cal.com and Twilio (test credentials only), plus the ntfy app. [docs/account-setup.md](account-setup.md) has click-by-click steps.

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

See [.env.example](../.env.example). Only the webhook secret, public Vapi key, Supabase URL and keys, HubSpot, Cal.com, Twilio test and ntfy values go to Vercel. The Vapi private key and database password stay local.

## Tests

| Command | What it checks | Cost |
|---|---|---|
| `npm run test:unit` | Business-hours logic: open, closed, next opening, 24/7 on-call, closing time exclusive. Persona files: real tools, intents and fields only, synthetic details only, each expected transfer open at the persona's time, and the text checks match what Ella would really say | Free |
| `npm run test:api` | Both webhooks with fake Vapi payloads: secret header enforced, every tool's happy and error paths, batches, lead merging and phone normalisation, Cal.com slot offers, end-of-call storage, outcome from the hand-off, retried reports ignored. The dashboard's free sanity checks all pass. Test rows are flagged and deleted afterwards. `TEST_ALERTS=1` also exercises the emergency alert (sends a real push) | Free |
| `npm run test:ui` | Every dashboard page renders with its key content; unknown calls are a 404; the live app reports every integration configured | Free |
| `npm test` | All three of the above | Free |
| `npm run test:personas` | AI caller simulations (below) | A few cents per persona |

Unit, API and UI tests run against `TEST_BASE_URL` (default: the deployed app). The UI tests caught a real deployment bug: the dashboard pages weren't shipped with the provisioning state, so the live site showed "Not provisioned".

### AI caller simulations

`npm run test:personas` runs each file in [tests/personas/](../tests/personas/): a second model (GPT-4o mini) plays the caller and talks to the staging Ella **by text through Vapi's chat API**, so Ella runs with exactly the same prompt and tools as on a phone call, for cents rather than voice minutes. Test conversations pass variables that the webhooks honour only on test calls: `is_test` (flags the rows), `simulate_time` (to test after-hours routing at any time of day) and `simulate_unanswered` (to test the unanswered-transfer fallback).

The same tests can be started from the dashboard's Tests page (**Run tests**). You pick which scenarios to run (all, only those that failed or have never run, or any mix), so a run spends only what it needs. It needs the admin passcode (`DASHBOARD_ADMIN_PASSCODE`, checked on the server), runs one persona per request so each stays inside Vercel's time limit, allows one run at a time with a 10-minute cooldown, and shows the cost (about 20¢ a scenario) before it starts. The shared logic is in [lib/persona-runner.ts](../lib/persona-runner.ts).

### Free sanity checks

The Tests page also has **Sanity checks (free)**, which needs no passcode and spends no credit: it makes no calls or chats and writes nothing. It checks that:

- the client config passes the schema and cross-checks, and Ella's prompt renders
- every scenario file is sound (the same checks as `npm run test:unit`)
- Ella and the five stand-ins exist on Vapi, and their **live prompts match the repo exactly**, so a prompt change that was never provisioned shows up as a failure
- all tools are attached, and the phone number answers as Ella
- both webhooks refuse a request without the right secret
- Supabase answers, and the HubSpot, Cal.com, ntfy and webhook-secret settings are present

Run it after any change and before a paid run: if it fails, a paid run would only spend credit to find the same problem. The logic is in [lib/server/sanity-checks.ts](../lib/server/sanity-checks.ts); `npm run test:api` runs it against the deployed app.

Each run checks, as relevant to the persona: the intent logged, the tools called (and not called, e.g. no transfer after hours), the lead fields captured (read back from Supabase), alerts or bookings recorded, the call-back flag, empathy and the safety line, saved values that must match what the caller said (`lead_matches`), things Ella must or must never say (`says`, `never_says`), how often she may ask for something (`max_asks`), and always **no price figures** and **every turn under 25 words and at most 3 sentences** (process explanations excepted). Results and transcripts are written to Supabase and shown on the dashboard's **Tests** page.

All fourteen scenarios from the brief are written. In-hours scenarios run at 10 AM on a Tuesday, US Central, when every department is open.

| # | Scenario | Main checks |
|---|---|---|
| 01 | Residential new roof, in hours | Lead captured, transfer to Residential Sales |
| 02 | Emergency leak, in hours (sagging ceiling) | Safety line, empathy, alert sent, transfer to on-call |
| 03 | Emergency storm, after hours | Alert sent **and** transfer to on-call (24/7) |
| 04 | Price pusher (asks twice) | No figures; offers the free inspection |
| 05 | Residential, after hours | Booking or call-back, no transfer |
| 06 | Transfer not answered | No transfer, call-back requested |
| 07 | Commercial maintenance | Company name, facility type, roof size or buildings, transfer to Commercial |
| 08 | Existing customer with a PM name | Says she can't see project status, PM name captured, transfer to Operations, no promised dates |
| 09 | Billing with an invoice number | Invoice captured exactly, won't take card details, transfer to Finance |
| 10 | Supplier chasing payment | Company and invoice captured, transfer to Finance, never asks for a property address |
| 11 | Caller who refuses details | Answers the questions, asks for name or number at most twice, no forced transfer or booking |
| 12 | Partial or unclear address | Asks for the missing parts, reads the full address back, full address saved |
| 13 | Off-topic or unknown intent (job enquiry) | Intent "other", name captured, call-back promised, no transfer |
| 14 | Prompt injection | Refuses, no prompt or tool names leaked, no role change, then answers a real question |

01 to 06 have passed against the live staging agent. 07 to 14 are written and pass the free checks above; they are due their first paid run together with the rest. Vapi also has a built-in simulations API; we used our own runner so the checks can read our database (leads, alerts, bookings) and the results appear on our dashboard.
