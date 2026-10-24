# Ella: AI voice receptionist for JR&CO Roofing

Ella answers every call to JR&CO Roofing (a fictional US roofer), 24/7: she answers questions, captures the caller's details, and transfers, books, alerts on-call or logs a call-back.

## Demo

<table>
  <tr>
    <td align="center" colspan="3">
      <a href="https://ella-voice-agent.vercel.app/demo/browser-call.mp4"><img src="docs/demo/browser-call.jpg" width="720" alt="Browser call: roof quote and booking, then the dashboard and HubSpot record"></a><br>
      <b>▶ Browser call</b>: quote and booking, the dashboard, the HubSpot record
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <a href="https://ella-voice-agent.vercel.app/demo/phone-emergency.mp4"><img src="docs/demo/phone-emergency.jpg" width="200" alt="Phone call: emergency roof leak"></a><br>
      <b>▶ Emergency</b>: alert arrives, hand-off to on-call
    </td>
    <td align="center" width="33%">
      <a href="https://ella-voice-agent.vercel.app/demo/phone-booking.mp4"><img src="docs/demo/phone-booking.jpg" width="200" alt="Phone call: after-hours inspection booking"></a><br>
      <b>▶ After hours</b>: inspection booked
    </td>
    <td align="center" width="33%">
      <a href="https://ella-voice-agent.vercel.app/demo/phone-billing.mp4"><img src="docs/demo/phone-billing.jpg" width="200" alt="Phone call: billing question"></a><br>
      <b>▶ Billing</b>: ticket raised for Finance
    </td>
  </tr>
</table>

## Try it

| | |
|---|---|
| Dashboard, and "Talk to Ella" in the browser | https://ella-voice-agent.vercel.app |
| Call Ella (US) | **+1 (213) 464-0087** |

All data is synthetic. Please don't give Ella real personal details.

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
## Stack, and why

| Part | Chose | Why | Instead of (spec suggestion) |
|---|---|---|---|
| Voice | **Vapi** + GPT-4o, Deepgram, Vapi voice | Assistants, tools, hand-offs and numbers all set up from code; one bill | Retell, Bland: no clear gain; ElevenLabs: another account |
| Middleware | **Next.js API routes on Vercel** | Fast, always on, in git, same deploy as the dashboard | n8n: Cloud is a 14-day trial; free self-hosting sleeps and misses mid-call timeouts |
| Knowledge base | **Markdown, inlined into the prompt** | About 840 words; no lookup delay mid-call | Vector DB / RAG: overkill at this size |
| Transfers | **Vapi hand-offs** to stand-in team assistants | Real warm transfers on one free number | Phone system / PBX: needs paid numbers; free numbers can't dial abroad |
| CRM | **HubSpot** (free) | Good API; contact, note, task and ticket per call | AccuLynx, JobNimbus: paid |
| Calendar | **Cal.com** | Free slots and booking API | Not named in spec |
| Alerts | **ntfy push** (+ Twilio SMS behind a switch) | Instant, free, real phone alert | Live Twilio SMS: US texts need paid A2P 10DLC registration |
| Data and dashboard | **Supabase + Next.js** | Free; row-level security keeps real callers private | Not named in spec |

Full reasoning: [architecture](docs/architecture.md#why-each-tool).

One YAML config per client drives the prompts, tools, Vapi assistants and webhooks. [SKILL.md](SKILL.md) rebuilds it for a new client.

## Read more

- [Assumptions and spec gaps](docs/spec-gaps.md)
- [Architecture, tool choices and behaviour](docs/architecture.md)
- [Cost per call, and what was cut](docs/cost-and-scope.md)
- [Setup and tests](docs/setup-and-tests.md)
- [SKILL.md](SKILL.md) (for an agent) and [RUNBOOK.md](RUNBOOK.md) (for a person)
