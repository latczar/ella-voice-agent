# Assumptions and spec gaps

Back to the [README](../README.md).

| Gap in the spec | What we did |
|---|---|
| Brevity: "2 to 3 sentences" in one place, "under 25 words" in another | Both: under 25 words and at most 3 sentences, except multi-step process explanations |
| No business hours, timezone, location or transfer numbers | US Central (America/Chicago). Sales, Commercial, Operations: Mon to Fri 7am to 6pm, Sat 8am to noon. Finance: Mon to Fri 8am to 5pm. On-call: 24/7. All in `configs/jrco.yaml` |
| Locale not stated | Built for the US: US English, US numbers, 911 |
| Callers from outside the US | Vapi's free numbers are for US use only, and a test call from outside the US was dropped before it reached Vapi. US callers are the expected audience. For international callers, import a Twilio or SIP number into Vapi (provisioning currently creates free Vapi numbers only, so this needs a small change there). The browser call works from anywhere |
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
