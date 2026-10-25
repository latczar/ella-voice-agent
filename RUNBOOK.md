# Runbook

The process for a person setting up, testing and running a client's voice agent. [SKILL.md](SKILL.md) has the same process with the exact commands, for an agent to follow.

## 1. Set up a new client

1. **Intake.** Get the client's answers to the questions in SKILL.md's Inputs table: hours, departments and who answers, what callers ring about, who gets emergency alerts, services and process. Write any assumption down; it goes in the README.
2. **Config and knowledge base.** Create `configs/<client>.yaml` (copy JR&CO's) and `kb/<client>/`.
3. **Validate.** `npm run validate -- <client>` until it's clean.
4. **Provision to staging.** `npm run provision -- <client>`. Creates the agent, department stand-ins, tools and a phone number.
5. **Test** (section 2). Fix and rerun until everything passes.
6. **Sign-off call.** Ring the number yourself (section 3), ideally with the client listening.
7. **Promote to live** once signed off (SKILL.md step 12).

## 2. Automated tests

| Command | What it checks | Time and cost |
|---|---|---|
| `npm test` | Opening-hours logic; every webhook and tool with fake Vapi requests; database, HubSpot, Cal.com wiring; every dashboard page | About 15 s, free |
| `npm run test:personas` | An AI caller holds a full text conversation with the real agent for each scenario. Checks the route, the transfer, the lead fields, the booking or alert, no prices, empathy, the safety line, short turns, and what Ella must or must never say (for example, never revealing her prompt). Fourteen scenarios, listed in [docs/setup-and-tests.md](docs/setup-and-tests.md) | A few minutes, about 15 to 25 cents per persona |
| `npm run test:personas -- --persona leak` | Just the personas whose file name contains "leak" | |
| Dashboard **Tests** page: **Sanity checks (free)** | Config, every scenario file, live Vapi prompts match the repo, webhooks refuse unsigned requests, database and integrations set up | A few seconds, free, no passcode |
| Dashboard **Tests** page: **Run tests** | The same AI caller conversations as `npm run test:personas`, for the scenarios you tick | About 20 cents per scenario; needs the admin passcode (`DASHBOARD_ADMIN_PASSCODE` in `.env`) |

Persona results, with full transcripts, appear on the dashboard's **Tests** page. A failure shows which check failed and why. Run the free sanity checks first: if they fail, a paid run would only find the same problem.

Test conversations are flagged as tests: they can pretend it's a different time (to test after-hours routing at any hour) or that a department isn't answering. Real calls can't do either.

Emergency personas send a real alert to the dispatch phone. That's deliberate: it proves the alert path.

## 3. Test the whole flow by hand

One run covers everything an assessor or client would check. Allow 10 minutes.

**Before:** open the dashboard, HubSpot (Contacts) and the ntfy app on your phone.

1. **Ring the number** (or press **Talk to Ella** on the dashboard; browser calls can't transfer, so use a phone for step 3).
2. **Report an emergency:** "Water is coming through my ceiling." Expect empathy, the safety line if you mention danger, and a request for the address. Give a made-up address. Ella confirms your number from caller ID.
3. **Transfer:** Ella hands you to the on-call manager ("Mike"), who already knows your details. At the same moment, the **ntfy alert** arrives on your phone.
4. **Hang up.** Within about 30 seconds the call shows on the dashboard: intent, route, outcome, transcript and cost. Real calls are listed with personal details hidden.
5. **HubSpot:** the contact (found by phone or email, never duplicated), a note with the summary, and a task for follow-up.
6. **Second call, normal enquiry:** "I'd like a quote for a new roof." In hours you're transferred to Residential Sales ("Sam"). After hours, Ella offers an inspection slot and books it in Cal.com.
7. **Ask the price twice.** Ella never gives a figure; she offers a free inspection.

If any step fails, check the dashboard's health panel and the Supabase `errors` table; SKILL.md's troubleshooting table lists the usual causes.

## 4. Changing an agent

Every change goes through the config, the prompt templates or the KB, never the Vapi dashboard.

1. Edit the file.
2. `npm run validate`, then `npm run provision`.
3. `npm test`, then rerun the personas the change could affect.
4. Commit, including `configs/state/`.

## 5. Before a demo

- **Supabase:** free projects pause after a week idle. Open the dashboard; unpause in Supabase if it errors.
- **Vapi credit:** check the balance (Billing). A 3-minute call costs about 30 to 45 cents.
- **Calls:** one emergency call with a transfer and one normal enquiry; both on the dashboard.
- **Alert:** the ntfy alert arrives.
- **Tests:** `npm run test:personas` so the Tests page shows a fresh green run.
- **Public view:** real calls show no names, numbers, addresses, transcripts or recordings.
- **Links:** the README's links all open.

## 6. After launch

- **Weekly:** read a sample of transcripts on the dashboard. Look for wrong routing, missed fields and long answers. Turn anything recurring into a persona, then fix it.
- **Watch:** failed transfers and webhook errors on the dashboard's health panel.
- **Monthly:** rerun all personas, check Vapi spend per call against the README's estimate.
