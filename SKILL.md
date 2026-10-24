---
name: build-voice-agent
description: Build, test or update an inbound AI voice receptionist (like Ella for JR&CO Roofing) for a client from a config file. Use when asked to set up a voice agent for a new client, change an existing client's agent (hours, departments, routing, prompt, knowledge base), or rerun its tests.
---

# Build a client voice agent

Everything is driven by one YAML config per client. Prompts, Vapi resources, routing and tests are generated from it, so a new client is mostly a new config plus a knowledge base. Never set things up by hand in the Vapi dashboard: the next `provision` run would drift from it.

## Before you start

You need a filled `.env` (see `.env.example` and `docs/account-setup.md`). Check it with:

```
npm run check
```

All of Supabase, HubSpot, Cal.com and ntfy should say ok. If not, fix that first: the tests depend on them.

## Inputs

Ask the client (or whoever briefed you) for anything below that's missing. Don't invent business facts; if they're unknown, make a clear assumption, mark it in the config with a comment, and list it in the README's assumptions table.

| Input | Config section | If missing |
|---|---|---|
| Business name, agent name, greeting | `business`, `agent` | Ask. Greeting must include the recording consent line |
| Country, timezone, emergency number | `locale` | Ask; don't guess the timezone |
| Opening hours, per department if they differ | `hours` | Ask. Emergencies are always 24/7 |
| Departments: name, who answers, warm or cold, fallback | `departments` | Ask for each. With no real number, use `transfer_to: assistant` (a stand-in that answers as that team) |
| What callers ring about, and where each goes in and out of hours | `intents` | Start from `configs/jrco.yaml` and confirm |
| Who gets emergency alerts, and how (`sms_mode`) | `alerts` | Default `push` (ntfy). `live` SMS in the US needs A2P 10DLC registration |
| CRM and calendar | `crm`, `calendar` | HubSpot and Cal.com are supported |
| Services, warranties, process, FAQs | `kb/<client_id>/*.md` | Ask for their website or brochure. Never add prices |
| Pricing wording, empathy lines, safety line | `policies` | Copy from JR&CO and adapt |

## Steps

1. **Write the config.** Copy `configs/jrco.yaml` to `configs/<client_id>.yaml` and edit it. Keep `environment: staging`.
2. **Write the knowledge base.** One markdown file per topic in `kb/<client_id>/`. Plain spoken English, short paragraphs, no prices, no promises of timings the client hasn't given.
3. **Validate.** `npm run validate -- <client_id>`. It checks the schema and cross-references (intents to departments, hours names, numbers). Fix every error.
4. **Preview the prompts.** `npm run render -- <client_id>` writes the rendered prompts to read through. Check that the routing section reads correctly for each intent.
5. **Dry run.** `npm run provision -- <client_id> --dry-run` shows exactly what would be sent to Vapi.
6. **Provision to staging.** `npm run provision -- <client_id>`. It creates or updates the assistant, department assistants, tools and phone number, and saves their IDs in `configs/state/<client_id>.staging.json`. It's idempotent: rerun it after every config, prompt or KB change. Commit the state file.
7. **Run the fast tests.** `npm test` (unit, webhook API and dashboard UI; free, about 15 seconds). All must pass.
8. **Write personas.** Copy `tests/personas/*.yaml` and adapt names, details and expectations to the client. Cover at least: a standard enquiry in hours, an emergency in hours, an emergency after hours, a price pusher, an enquiry after hours, and a transfer nobody answers. Use only made-up details (`@example.com` emails, 555 numbers).
9. **Run the personas.** `npm run test:personas` (about 15 cents each). For one persona: `npm run test:personas -- --persona <part of its file name>`.
10. **Fix and rerun.** For each failure, read the transcript on the dashboard's Tests page. Fix the config, prompt template or KB, never the test to make it pass (unless the test itself is wrong; say why in the commit). Re-provision, then rerun only the failing personas.
11. **Make one real voice call** to the number, including an emergency (to hear a transfer and receive the alert). Check the call appears on the dashboard and in HubSpot.
12. **Promote.** Set `environment: live` in a copy of the config (or switch it once staging is signed off) and provision again. That builds a separate live assistant and number, so staging stays available for tests.

## Rules

- Never quote prices, in the prompt, KB or tests. The test harness fails any turn with a figure.
- The greeting includes the recording consent line. SMS needs opt-in wording before texting a caller.
- Emergencies: safety line first if there's any danger, then the address, the alert, and the transfer. Always 24/7.
- Synthetic data only in tests, seeds and examples. Never a real customer's details.
- Secrets only in `.env` and Vercel environment variables. Never commit keys. Never print `.env` values.
- Brevity: under 25 words and at most 3 sentences per turn, except process explanations and the safety line.

## Done when

- `npm run validate`, `npm test` and `npm run test:personas` all pass.
- The latest run on the dashboard's Tests page is green, with transcripts as evidence.
- One real call has been made and shows on the dashboard, with the HubSpot record and (for an emergency) the alert received.
- The README's assumptions table lists every assumption made for this client.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Transfer doesn't happen | Intent's department wrong, or a department missing from provisioning | Check `intents[].department`; rerun `provision`; look for `transfer_to_<dept>` in the tool list |
| Ella books instead of transferring (or the other way) | `check_hours` thinks it's closed | Check `hours` and `locale.timezone`. In tests, check the persona's `time` (UTC) |
| Lead fields missing | Caller didn't give them, or Ella didn't call `log_lead` | Read the transcript. Tighten the intent's `collect` list or the prompt's capture rule |
| Tool says "something went wrong" | Webhook error | Dashboard health panel and the Supabase `errors` table give the message |
| Booking fails | Cal.com event type ID or API key, or an email that can't receive mail | `npm run check`; test calls book against a throwaway inbox |
| No alert on the phone | Wrong ntfy topic, or app not subscribed | `npm run check -- --push` sends a test alert |
| Persona fails on brevity | Long goodbyes or stacked sentences | Prompt's brevity line; rerun just that persona |
| Vapi chat returns 402 | No payment method on the Vapi account | Add a card under Billing |
| Slow replies on calls | Webhook cold start or a slow integration | Check Vercel function logs; keep tool handlers to one external call each |
