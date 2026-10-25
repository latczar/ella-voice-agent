# Cost per call, and what was cut

Back to the [README](../README.md).

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

**Measured:** four real phone calls (two emergencies with a hand-off, an after-hours booking and a billing call) averaged **$0.24 for 79 seconds**, so about **18 cents a minute**: a little above the estimate. Each call includes its tool calls and, where there was a hand-off, the stand-in assistant's time; on a 3-minute call that rate comes to about $0.55. Two browser calls came to about 17 cents a minute. Text test conversations through Vapi's chat API cost about 15 to 25 cents each, counting both Ella and the AI caller (billed per message, not per minute). To re-measure as calls build up: `select avg(cost_usd), avg(duration_s) from calls where channel = 'phone' and not is_demo and not is_test;`

**What live SMS would add:** a US Twilio text is about $0.008 to $0.01 per segment plus carrier fees, so an emergency alert to a three-person dispatch group is about 3 to 5 cents. A2P 10DLC registration adds one-off brand and campaign fees and a small monthly campaign fee. ntfy push, used here, is free.

## What was prioritised, and what was cut

The brief asks for a working core over polish, so the tiers were built in order and each was working before the next began.

**Prioritised**
- **The working core first:** Ella on a real number and in the browser, the config file and schema, the prompt templates, the in-call tools, the webhooks, and an idempotent provisioning script. Everything is created from code; nothing was clicked together in a dashboard.
- **Safety and routing over breadth:** emergencies (safety line, 24/7 alert plus transfer), never quoting prices, and the unanswered-transfer fallback were built and tested before anything cosmetic.
- **Tests that read real outcomes:** the persona harness checks the database (leads, alerts, bookings), not just the transcript, and its results show on the dashboard.
- **Spec gaps written down** as they were found, rather than left until the end.

**Cut or reduced**
- **Twilio SMS:** Twilio's sign-up phone verification would not accept the developer's numbers, so no test credentials could be issued. The `test` SMS mode is built but not exercised; alerts go by ntfy push (`sms_mode: push`). Live SMS was never planned (A2P 10DLC, see [spec gaps](spec-gaps.md)).
- **Personas 07 to 14** (commercial, existing customer, billing, supplier, refuser, unclear address, off-topic, prompt injection): the behaviour is in the prompt and routing, but only the six core personas have automated runs. Each run costs Vapi credit, so runs were kept to what proved the core.
- **Real phone transfers:** stand-in department assistants via Vapi hand-offs instead, as the free number cannot dial out. A real number can be set per department in the config.
- **Email:** no email service; high-priority HubSpot tasks instead.
