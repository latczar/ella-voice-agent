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
| `npm run test:unit` | Business-hours logic: open, closed, next opening, 24/7 on-call, closing time exclusive | Free |
| `npm run test:api` | Both webhooks with fake Vapi payloads: secret header enforced, every tool's happy and error paths, batches, lead merging and phone normalisation, Cal.com slot offers, end-of-call storage, outcome from the hand-off, retried reports ignored. Test rows are flagged and deleted afterwards. `TEST_ALERTS=1` also exercises the emergency alert (sends a real push) | Free |
| `npm run test:ui` | Every dashboard page renders with its key content; unknown calls are a 404; the live app reports every integration configured | Free |
| `npm test` | All three of the above | Free |
| `npm run test:personas` | AI caller simulations (below) | A few cents per persona |

Unit, API and UI tests run against `TEST_BASE_URL` (default: the deployed app). The UI tests caught a real deployment bug: the dashboard pages weren't shipped with the provisioning state, so the live site showed "Not provisioned".

### AI caller simulations

`npm run test:personas` runs each file in [tests/personas/](../tests/personas/): a second model (GPT-4o mini) plays the caller and talks to the staging Ella **by text through Vapi's chat API**, so Ella runs with exactly the same prompt and tools as on a phone call, for cents rather than voice minutes. Test conversations pass variables that the webhooks honour only on test calls: `is_test` (flags the rows), `simulate_time` (to test after-hours routing at any time of day) and `simulate_unanswered` (to test the unanswered-transfer fallback).

The same tests can be started from the dashboard's Tests page (**Run tests**). It needs the admin passcode (`DASHBOARD_ADMIN_PASSCODE`, checked on the server), runs one persona per request so each stays inside Vercel's time limit, allows one run at a time with a 10-minute cooldown, and shows the cost (about 13¢ a persona) before it starts. The shared logic is in [lib/persona-runner.ts](../lib/persona-runner.ts).

Each run checks, as relevant to the persona: the intent logged, the tools called (and not called, e.g. no transfer after hours), the lead fields captured (read back from Supabase), alerts or bookings recorded, the call-back flag, empathy and the safety line, and always **no price figures** and **every turn under 25 words and at most 3 sentences** (process explanations excepted). Results and transcripts are written to Supabase and shown on the dashboard's **Tests** page.

The six core personas from the brief are written: residential in hours, emergency leak in hours (with danger), emergency storm after hours, price pusher, residential after hours, transfer not answered. Vapi also has a built-in simulations API; we used our own runner so the checks can read our database (leads, alerts, bookings) and the results appear on our dashboard.
