// In-call tool handlers. Vapi waits on these while the caller is on the line, so each one
// does the minimum needed to answer Ella and returns plain facts as a JSON string.
// Slow, non-urgent work (HubSpot) happens after the call, in the end-of-call webhook.

import type { LeadField } from "../config";
import { checkHours } from "../hours";
import { createBooking, eventTypeId, getSlots } from "../integrations/calcom";
import { sendPush } from "../integrations/ntfy";
import { sendSms } from "../integrations/sms";
import type { CallContext } from "./context";
import { getLead, logError, mergeLead, recordAction, upsertCall, type LeadRow } from "./db";

type Args = Record<string, unknown>;
export type ToolHandler = (args: Args, ctx: CallContext) => Promise<object>;

const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** US numbers to E.164 (+1XXXXXXXXXX); anything else is kept with a leading +. */
export function toE164(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : undefined;
}

/** Make sure the call row exists before child rows (leads, actions) reference it. */
async function touchCall(ctx: CallContext, extra: Record<string, unknown> = {}): Promise<void> {
  await upsertCall({
    id: ctx.callId,
    client_id: ctx.config.client_id,
    channel: ctx.channel,
    caller_number: ctx.callerNumber,
    is_test: ctx.isTest,
    ...extra,
  });
}

// ---- check_hours -----------------------------------------------------------

const check_hours: ToolHandler = async (args, ctx) => {
  const key = s(args.department);
  const dept = key ? ctx.config.departments[key] : undefined;
  if (!key || !dept) {
    return { error: `Unknown department "${key}". Use one of: ${Object.keys(ctx.config.departments).join(", ")}.` };
  }
  const hours = checkHours(dept.hours, ctx.config.locale.timezone, ctx.simulatedNow ?? undefined);
  const simulatedUnanswered = ctx.simulateUnanswered.includes(key);
  const canTransfer = hours.open && !simulatedUnanswered;
  return {
    department: dept.name,
    can_transfer: canTransfer,
    open: hours.open,
    next_available: canTransfer ? null : hours.nextOpen ?? "as soon as possible",
    local_time: hours.localTime,
    note: canTransfer
      ? "Transfer after log_lead."
      : hours.open
        ? "Nobody can pick up right now. Don't transfer: apologize, promise a call-back shortly, and log_lead with callback_requested true."
        : "Closed now. Follow the route's after-hours action.",
  };
};

// ---- log_lead --------------------------------------------------------------

const LEAD_FIELDS = [
  "full_name", "email", "property_address", "property_type", "company_name", "facility_type",
  "roof_size_or_buildings", "pm_name", "invoice_or_account_number", "urgency", "summary",
] as const;

const log_lead: ToolHandler = async (args, ctx) => {
  const intent = ctx.config.intents.find((i) => i.id === args.intent);
  if (!intent) return { error: `Unknown intent "${String(args.intent)}".` };

  const lead: Record<string, string | boolean | undefined> = {
    call_id: ctx.callId,
    client_id: ctx.config.client_id,
    intent: intent.id,
    caller_need: s(args.caller_need) ?? intent.caller_need,
    phone: toE164(s(args.phone)) ?? ctx.callerNumber ?? undefined,
    callback_requested: args.callback_requested === true ? true : undefined,
    sms_opt_in: args.sms_opt_in === true ? true : undefined,
  };
  for (const f of LEAD_FIELDS) lead[f] = s(args[f]);

  await touchCall(ctx, { intent: intent.id, route: intent.department });
  const saved = await mergeLead(lead as LeadRow);
  const merged = { ...(saved ?? {}), ...Object.fromEntries(Object.entries(lead).filter(([, v]) => v !== undefined)) };

  // Tell Ella what's still missing for this route, so she can ask for it.
  const missing = intent.required_fields.filter((f: LeadField) => !merged[f]);
  return {
    saved: Boolean(saved),
    missing_fields: missing,
    note: missing.length ? `Still needed for this route: ${missing.join(", ")}.` : "All required details captured.",
  };
};

// ---- send_emergency_alert --------------------------------------------------

const send_emergency_alert: ToolHandler = async (args, ctx) => {
  const address = s(args.property_address);
  const summary = s(args.summary) ?? "Emergency roof call";
  if (!address) return { error: "property_address is required. Ask for the address first." };

  const callback = toE164(s(args.callback_number)) ?? ctx.callerNumber ?? "unknown";
  const name = s(args.caller_name) ?? "Caller";
  const danger = args.danger_reported === true;
  const c = ctx.config;
  const text = `${c.business.short_name} EMERGENCY: ${summary}. Address: ${address}. Call back ${name} on ${callback}.${danger ? " DANGER REPORTED: caller told to leave the area and call 911." : ""}`;

  // Save the emergency as a lead here too, so it's on record even if log_lead is never called.
  const emergencyIntent = c.intents.find((i) => i.emergency);
  await touchCall(ctx, { intent: emergencyIntent?.id ?? "emergency", route: emergencyIntent?.department });
  await mergeLead({
    call_id: ctx.callId, client_id: c.client_id, intent: emergencyIntent?.id ?? "emergency", property_address: address, urgency: "emergency",
    phone: toE164(s(args.callback_number)) ?? ctx.callerNumber ?? undefined, full_name: s(args.caller_name), summary,
  });

  // Text the dispatch group and push, in parallel; both are quick.
  const topic = process.env[c.alerts.push.topic_env] ?? "";
  const [sms, push] = await Promise.all([
    sendSms(c, c.alerts.dispatch_sms_group, text, "Emergency"),
    c.alerts.push.emergency_always && c.alerts.sms_mode !== "push"
      ? sendPush(topic, { title: `🚨 ${c.business.short_name} emergency`, message: text, priority: "urgent", tags: ["rotating_light"] })
      : Promise.resolve({ ok: true, skipped: true } as { ok: boolean; skipped?: boolean; error?: string }),
  ]);

  const smsOk = sms.some((r) => r.ok);
  await recordAction(ctx.callId, "sms", smsOk ? "ok" : "failed", { mode: c.alerts.sms_mode, results: sms });
  // In push mode the "SMS" already arrived as a push, so a second push would just duplicate it.
  await recordAction(ctx.callId, "push", "skipped" in push ? "skipped" : push.ok ? "ok" : "failed", push);
  if (!smsOk && !push.ok) await logError("tool:send_emergency_alert", `All alert channels failed: ${sms.map((r) => r.error).join("; ")}`, ctx.callId);

  return {
    alert_sent: smsOk || push.ok,
    channels: { sms: smsOk ? `sent (${c.alerts.sms_mode} mode)` : "failed", push: "skipped" in push ? "delivered as the SMS alert" : push.ok ? "sent" : "failed" },
    note: "Now transfer to the on-call manager. If the transfer can't happen, tell the caller the on-call team has been alerted and will call back shortly.",
  };
};

// ---- check_availability / book_appointment ---------------------------------

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const check_availability: ToolHandler = async (args, ctx) => {
  const c = ctx.config;
  const slots = await getSlots(eventTypeId(c.calendar.event_type_id_env), c.locale.timezone, c.calendar.lookahead_days);
  if (!slots.length) return { available: false, note: "No free inspection slots soon. Offer a call-back to arrange a time." };

  const wantedDay = DAY_NAMES.find((d) => s(args.preferred_day)?.toLowerCase().includes(d));
  const pool = wantedDay ? slots.filter((x) => x.spoken.toLowerCase().startsWith(wantedDay)) : slots;
  // Spread the offers across different days: the first slot of each day.
  const byDay = new Map<string, (typeof slots)[number]>();
  for (const slot of pool.length ? pool : slots) {
    const day = slot.spoken.split(" at ")[0];
    if (!byDay.has(day)) byDay.set(day, slot);
  }
  const offers = [...byDay.values()].slice(0, c.calendar.slots_to_offer);
  return {
    available: true,
    slots: offers.map((o) => ({ start_time: o.start, say: o.spoken })),
    note: wantedDay && !pool.length ? `Nothing free on ${wantedDay}; these are the nearest times.` : "Offer these times; book only the one the caller picks.",
  };
};

const book_appointment: ToolHandler = async (args, ctx) => {
  const c = ctx.config;
  const start = s(args.start_time);
  const name = s(args.full_name);
  const email = s(args.email);
  const address = s(args.property_address);
  if (!start || !name || !email || !address) return { error: "start_time, full_name, email and property_address are all required." };

  const phone = toE164(s(args.phone)) ?? ctx.callerNumber ?? undefined;
  const booking = await createBooking({
    eventTypeId: eventTypeId(c.calendar.event_type_id_env),
    // Cal.com rejects addresses that can't receive mail, so test calls (synthetic @example.com
    // addresses) book against a throwaway public inbox. The lead keeps the address given.
    start, name, email: ctx.isTest ? "jrco-ella-tests@mailinator.com" : email, phone, address, timeZone: c.locale.timezone, notes: s(args.notes), callId: ctx.callId,
  });
  await touchCall(ctx, { outcome: "booked" });
  // Safety net if log_lead was skipped: a booking implies the intent whose team falls back to calendar bookings.
  const existing = await getLead(ctx.callId);
  const bookingIntent = existing?.intent ? undefined : c.intents.find((i) => !!i.department && c.departments[i.department]?.after_hours_fallback.includes("calendar_booking"));
  await mergeLead({
    call_id: ctx.callId, client_id: c.client_id, full_name: name, email, phone, property_address: address,
    ...(bookingIntent ? { intent: bookingIntent.id, caller_need: bookingIntent.caller_need } : {}),
  });
  await recordAction(ctx.callId, "booking", "ok", { uid: booking.uid, start: booking.start, status: booking.status });
  return { booked: true, status: booking.status, confirmation: "A confirmation email is on its way to the caller." };
};

export const handlers: Record<string, ToolHandler> = {
  check_hours,
  log_lead,
  send_emergency_alert,
  check_availability,
  book_appointment,
};

/** Runs one tool call. Failures are logged and returned as an error string, which makes Vapi
 * speak the tool's request-failed line, so the caller always hears a sensible next step. */
export async function runTool(name: string, args: Args, ctx: CallContext): Promise<{ result?: string; error?: string }> {
  const handler = handlers[name];
  if (!handler) return { error: `Unknown tool "${name}".` };
  try {
    const out = await handler(args, ctx);
    return "error" in out ? { error: String((out as { error: unknown }).error) } : { result: JSON.stringify(out) };
  } catch (err) {
    await logError(`tool:${name}`, (err as Error).message, ctx.callId, { args });
    return { error: `The ${name} tool failed. Use your fallback.` };
  }
}

