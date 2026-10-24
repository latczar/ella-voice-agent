// Seeds synthetic demo calls (is_demo = true) so the dashboard never looks empty.
// Idempotent: fixed IDs, upserted. Remove them with --clear.
// Usage: npm run seed-demo   |   npm run seed-demo -- --clear
// All people, numbers and addresses are invented (555-01xx numbers, example.com emails).

import "dotenv/config";
import { db } from "../lib/server/db";

interface Demo {
  id: string;
  hoursAgo: number;
  duration: number;
  intent: string;
  route: string | null;
  outcome: string;
  reason: string;
  cost: number;
  summary: string;
  transcript: [string, string][];
  lead: Record<string, string | boolean>;
  actions: [string, string][];
}

const DEMOS: Demo[] = [
  {
    id: "demo-01", hoursAgo: 3, duration: 214, intent: "new_residential", route: "residential_sales", outcome: "transferred", cost: 0.27,
    reason: "Handed off to Residential Sales (New residential quote or free inspection).",
    summary: "Homeowner wants a quote to replace a 20-year-old shingle roof. Details captured and transferred to Residential Sales.",
    transcript: [
      ["AI", "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"],
      ["User", "Hi, my roof's about twenty years old and I'd like a quote to replace it."],
      ["AI", "Happy to help with that. Could I get your full name, please?"],
      ["User", "It's Jordan Avery."],
      ["AI", "Thanks, Jordan. Is three one two, five five five, zero one four two the best number to reach you?"],
      ["User", "Yes, that's my cell."],
      ["AI", "Great. What's the property address, including the ZIP code?"],
      ["User", "2240 West Example Avenue, Chicago, 60618."],
      ["AI", "Thank you. And that's a home rather than a business property?"],
      ["User", "Yes, it's our house."],
      ["AI", "Perfect. I'll connect you with Sam in Residential Sales now."],
    ],
    lead: { full_name: "Jordan Avery", phone: "+13125550142", property_address: "2240 W Example Ave, Chicago, IL 60618", property_type: "residential", caller_need: "New Roof", urgency: "normal", summary: "Wants a quote to replace a 20-year-old shingle roof." },
    actions: [["crm_contact", "ok"]],
  },
  {
    id: "demo-02", hoursAgo: 9, duration: 168, intent: "emergency", route: "on_call", outcome: "transferred", cost: 0.22,
    reason: "Handed off to On-Call Manager (Emergency roof leak or storm damage).",
    summary: "Active leak through a bedroom ceiling after hail. Safety line given, dispatch alerted, transferred to on-call.",
    transcript: [
      ["AI", "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"],
      ["User", "Water's coming through our bedroom ceiling after that hailstorm and the ceiling's starting to sag."],
      ["AI", "I'm so sorry to hear that. If the ceiling could come down, please get everyone out of that room now, and call 911 if anyone's in danger."],
      ["User", "Okay, we're out of the room."],
      ["AI", "Good. What's the property address?"],
      ["User", "418 North Sample Street, Evanston, 60201."],
      ["AI", "Thank you. I'm alerting our on-call team now, and connecting you to Mike, our on-call manager."],
    ],
    lead: { phone: "+18475550117", property_address: "418 N Sample St, Evanston, IL 60201", property_type: "residential", caller_need: "Storm Damage", urgency: "emergency", summary: "Active leak through bedroom ceiling after hail; ceiling sagging." },
    actions: [["push", "ok"], ["sms", "ok"], ["crm_contact", "ok"], ["crm_task", "ok"]],
  },
  {
    id: "demo-03", hoursAgo: 20, duration: 241, intent: "new_residential", route: "residential_sales", outcome: "booked", cost: 0.29,
    reason: "Free inspection booked through Cal.com.",
    summary: "After-hours caller booked a free inspection for a leaking skylight area.",
    transcript: [
      ["AI", "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"],
      ["User", "I think there's damage around my skylight. Can someone take a look?"],
      ["AI", "Of course. Our sales team is closed right now, but I can book you a free, no-obligation inspection. Would that help?"],
      ["User", "Yes please."],
      ["AI", "I have Monday at 9 AM, Tuesday at 9 AM, or Wednesday at 10 AM. Which suits you?"],
      ["User", "Tuesday at nine."],
      ["AI", "Booked for Tuesday at 9 AM. You'll get a confirmation email shortly."],
    ],
    lead: { full_name: "Priya Sample", phone: "+17735550163", email: "priya.sample@example.com", property_address: "77 Demo Court, Oak Park, IL 60302", property_type: "residential", caller_need: "Repair", urgency: "normal", summary: "Possible damage around skylight; inspection booked." },
    actions: [["booking", "ok"], ["crm_contact", "ok"]],
  },
  {
    id: "demo-04", hoursAgo: 28, duration: 196, intent: "commercial", route: "commercial", outcome: "callback", cost: 0.24,
    reason: "Commercial project or maintenance: call-back requested (after hours or team unavailable).",
    summary: "Facilities manager wants a preventive maintenance program for two warehouses; high-priority call-back.",
    transcript: [
      ["AI", "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"],
      ["User", "I manage two warehouses and want to talk about a maintenance program for the flat roofs."],
      ["AI", "We can definitely help with that. What's the company name?"],
      ["User", "Northwind Logistics Demo."],
      ["AI", "Thanks. Roughly how large are the roofs, or how many buildings?"],
      ["User", "Two buildings, about 80,000 square feet each, TPO."],
      ["AI", "Got it. Our Commercial Division is closed now, so I've flagged this as high priority and they'll call you first thing."],
    ],
    lead: { full_name: "Sam Rivera", phone: "+13125550188", company_name: "Northwind Logistics (demo)", facility_type: "Warehouse", roof_size_or_buildings: "2 buildings, ~80,000 sq ft each, TPO", property_address: "1900 Industrial Way, Cicero, IL 60804", property_type: "commercial", caller_need: "New Roof", urgency: "high", callback_requested: true, summary: "Preventive maintenance program for two TPO warehouse roofs." },
    actions: [["crm_contact", "ok"], ["crm_task", "ok"]],
  },
  {
    id: "demo-05", hoursAgo: 46, duration: 131, intent: "billing", route: "finance", outcome: "lead_captured", cost: 0.16,
    reason: "Customer billing question: details captured.",
    summary: "Customer asked about a duplicate charge on an invoice; logged to the billing queue.",
    transcript: [
      ["AI", "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"],
      ["User", "I think I was charged twice on my last invoice."],
      ["AI", "I'm sorry about that. I can't see invoices, but I'll get Finance onto it. What's the invoice number?"],
      ["User", "INV 20417."],
      ["AI", "Thank you. Finance is closed now, so I've logged this for them and they'll call you next business day."],
    ],
    lead: { full_name: "Taylor Demo", phone: "+16305550109", caller_need: "Billing", invoice_or_account_number: "INV-20417", urgency: "normal", callback_requested: true, summary: "Possible duplicate charge on INV-20417." },
    actions: [["crm_contact", "ok"], ["crm_ticket", "ok"]],
  },
  {
    id: "demo-06", hoursAgo: 70, duration: 88, intent: "other", route: null, outcome: "no_action", cost: 0.11,
    reason: "No lead captured (question answered, wrong number, or caller hung up).",
    summary: "Caller asked what TPO roofing is; answered from the knowledge base.",
    transcript: [
      ["AI", "Thanks for calling J.R. and Co! My name is Ella. This call may be recorded for quality. How can I help you with your property today?"],
      ["User", "Quick question, what's a TPO roof?"],
      ["AI", "TPO is a white, single-ply membrane for flat roofs, with heat-welded seams. It reflects heat, which helps with cooling costs."],
      ["User", "Great, that's all I needed."],
    ],
    lead: {},
    actions: [],
  },
];

async function main(): Promise<void> {
  const supabase = db();
  if (!supabase) throw new Error("Supabase is not configured in .env");
  const ids = DEMOS.map((d) => d.id);

  if (process.argv.includes("--clear")) {
    await supabase.from("calls").delete().in("id", ids);
    console.log(`Removed ${ids.length} demo calls.`);
    return;
  }

  // Clear child rows first so reruns don't stack actions.
  await supabase.from("actions").delete().in("call_id", ids);

  for (const d of DEMOS) {
    const started = new Date(Date.now() - d.hoursAgo * 3600_000);
    const { error } = await supabase.from("calls").upsert({
      id: d.id, client_id: "jrco", started_at: started.toISOString(), ended_at: new Date(started.getTime() + d.duration * 1000).toISOString(),
      duration_s: d.duration, channel: "phone", caller_number: (d.lead.phone as string) ?? null, intent: d.intent, route: d.route,
      route_reason: d.reason, outcome: d.outcome, ended_reason: "customer-ended-call", cost_usd: d.cost,
      transcript: d.transcript.map(([r, t]) => `${r}: ${t}`).join("\n"), summary: d.summary, is_demo: true,
      report_processed_at: new Date().toISOString(),
    });
    if (error) throw new Error(`${d.id}: ${error.message}`);
    if (Object.keys(d.lead).length) {
      const { error: le } = await supabase.from("leads").upsert({ call_id: d.id, client_id: "jrco", intent: d.intent, ...d.lead });
      if (le) throw new Error(`${d.id} lead: ${le.message}`);
    }
    if (d.actions.length) await supabase.from("actions").insert(d.actions.map(([kind, status]) => ({ call_id: d.id, kind, status, detail: { demo: true } })));
  }
  console.log(`Seeded ${DEMOS.length} demo calls (is_demo = true).`);
}

main().catch((err) => {
  console.error(`seed-demo failed: ${(err as Error).message}`);
  process.exit(1);
});
