// Handles Vapi's end-of-call report: stores the call, works out the outcome, and syncs
// the lead to HubSpot with the right follow-up (note, task or billing-queue ticket).

import type { ClientConfig, Intent } from "../config";
import { addNote, createTask, createTicket, upsertContact } from "../integrations/hubspot";
import { sendPush } from "../integrations/ntfy";
import type { CallContext } from "./context";
import { db, getLead, logError, mergeLead, recordAction, upsertCall, type LeadRow } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>;

export interface CallSummary {
  intent: Intent | undefined;
  route: string | null;
  outcome: string;
  routeReason: string;
}

/** Department key of the hand-off Ella made, if any (from the transfer_to_<dept> tool calls). */
function handedOffTo(report: Report, config: ClientConfig): string | null {
  const text = JSON.stringify(report.artifact?.messages ?? report.messages ?? []);
  const keys = [...text.matchAll(/transfer_to_([a-z_]+)/g)].map((m) => m[1]).filter((k) => k in config.departments);
  return keys.at(-1) ?? null;
}

async function actionKinds(callId: string): Promise<Set<string>> {
  const supabase = db();
  if (!supabase) return new Set();
  const { data } = await supabase.from("actions").select("kind, status").eq("call_id", callId);
  return new Set((data ?? []).filter((a) => a.status === "ok").map((a) => a.kind as string));
}

export async function summarise(report: Report, ctx: CallContext, lead: LeadRow | null): Promise<CallSummary> {
  const c = ctx.config;
  const intent = c.intents.find((i) => i.id === lead?.intent);
  const transferredTo = handedOffTo(report, c);
  const done = await actionKinds(ctx.callId);
  const endedReason: string = report.endedReason ?? "";

  let outcome: string;
  let routeReason: string;
  if (transferredTo) {
    outcome = "transferred";
    routeReason = `Handed off to ${c.departments[transferredTo].name}${intent ? ` (${intent.label})` : ""}.`;
  } else if (done.has("booking")) {
    outcome = "booked";
    routeReason = "Free inspection booked through Cal.com.";
  } else if (lead?.callback_requested) {
    outcome = "callback";
    routeReason = intent ? `${intent.label}: call-back requested (after hours or team unavailable).` : "Call-back requested.";
  } else if (done.has("sms") || done.has("push")) {
    outcome = "sms_sent";
    routeReason = "Emergency alert sent to on-call dispatch.";
  } else if (lead) {
    outcome = "lead_captured";
    routeReason = intent ? `${intent.label}: details captured.` : "Details captured.";
  } else if (/error|failed/i.test(endedReason)) {
    outcome = "failed";
    routeReason = `Call ended with ${endedReason}.`;
  } else {
    outcome = "no_action";
    routeReason = "No lead captured (question answered, wrong number, or caller hung up).";
  }
  return { intent, route: transferredTo ?? intent?.department ?? null, outcome, routeReason };
}

function durationSeconds(report: Report): number | null {
  const start = Date.parse(report.startedAt ?? report.call?.startedAt ?? "");
  const end = Date.parse(report.endedAt ?? report.call?.endedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 1000) : null;
}

/** Store the call. Returns false if this report was already handled (Vapi retries webhooks). */
export async function storeCall(report: Report, ctx: CallContext): Promise<{ fresh: boolean; summary: CallSummary; lead: LeadRow | null }> {
  const supabase = db();
  if (supabase) {
    const { data } = await supabase.from("calls").select("report_processed_at").eq("id", ctx.callId).maybeSingle();
    if (data?.report_processed_at) return { fresh: false, summary: { intent: undefined, route: null, outcome: "", routeReason: "" }, lead: null };
  }

  const lead = await getLead(ctx.callId);
  const summary = await summarise(report, ctx, lead);
  await upsertCall({
    id: ctx.callId,
    client_id: ctx.config.client_id,
    started_at: report.startedAt ?? report.call?.startedAt ?? null,
    ended_at: report.endedAt ?? report.call?.endedAt ?? null,
    duration_s: durationSeconds(report),
    channel: ctx.channel,
    caller_number: ctx.callerNumber,
    intent: summary.intent?.id ?? null,
    route: summary.route,
    route_reason: summary.routeReason,
    outcome: summary.outcome,
    ended_reason: report.endedReason ?? null,
    cost_usd: typeof report.cost === "number" ? report.cost : null,
    recording_url: report.artifact?.recordingUrl ?? report.recordingUrl ?? null,
    transcript: report.artifact?.transcript ?? report.transcript ?? null,
    summary: report.analysis?.summary ?? report.summary ?? null,
    is_test: ctx.isTest,
    report_processed_at: new Date().toISOString(),
  });
  return { fresh: true, summary, lead };
}

/** After the call: HubSpot contact, note and follow-up, per the routing matrix. */
export async function syncToCrm(report: Report, ctx: CallContext, summary: CallSummary, lead: LeadRow | null): Promise<void> {
  if (!lead || (!lead.phone && !lead.email && !ctx.callerNumber)) return; // nothing to attach a contact to
  if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
    await recordAction(ctx.callId, "crm_contact", "skipped", { reason: "HubSpot not configured" });
    return;
  }
  const c = ctx.config;
  const callId = ctx.callId;
  try {
    const contactId = await upsertContact({
      fullName: lead.full_name as string | undefined,
      email: lead.email as string | undefined,
      phone: (lead.phone as string | undefined) ?? ctx.callerNumber,
      address: lead.property_address as string | undefined,
      company: lead.company_name as string | undefined,
    });
    await recordAction(callId, "crm_contact", "ok", { contactId });

    const fields = Object.entries(lead)
      .filter(([k, v]) => v && !["call_id", "client_id", "created_at", "updated_at", "hubspot_contact_id", "hubspot_record_id"].includes(k))
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join("<br>");
    const transcript = String(report.artifact?.transcript ?? "").slice(0, 20000).replace(/\n/g, "<br>");
    const details = `<b>Call with ${c.agent.name}</b> (${summary.outcome})<br>${summary.routeReason}<br><br>${fields}<br><br><b>Transcript</b><br>${transcript}`;
    // Notes may need a scope the key doesn't have; if so, the details ride on the follow-up instead.
    let noteSaved = true;
    try {
      await addNote(contactId, details);
    } catch (err) {
      noteSaved = false;
      await logError("hubspot:note", `Note not saved; details go in the follow-up instead: ${(err as Error).message}`, callId);
    }
    const body = (text: unknown) => (noteSaved ? String(text ?? "") : `${String(text ?? "")}<br><br>${details}`);

    // Follow-up record, per the routing matrix's after-hours / fallback column.
    const intentId = summary.intent?.id;
    const label = summary.intent?.label ?? "Call";
    const who = (lead.full_name as string) || (lead.company_name as string) || "Caller";
    let recordId: string | null = null;
    let kind: "crm_task" | "crm_ticket" | null = null;

    if (summary.intent?.emergency) {
      recordId = await createTask(contactId, `EMERGENCY: ${who} at ${lead.property_address ?? "address unknown"}`, body(lead.summary ?? summary.routeReason), "HIGH");
      kind = "crm_task";
    } else if ((intentId === "billing" || intentId === "supplier_payable") && summary.outcome !== "transferred") {
      const subject = `Billing queue: ${who}${lead.invoice_or_account_number ? `, invoice ${lead.invoice_or_account_number}` : ""}`;
      try {
        recordId = c.crm.billing_queue === "ticket" ? await createTicket(contactId, subject, body(lead.summary), "MEDIUM") : null;
        kind = recordId ? "crm_ticket" : null;
      } catch (err) {
        await logError("hubspot:ticket", `Ticket failed, falling back to a task: ${(err as Error).message}`, callId);
      }
      if (!recordId) {
        recordId = await createTask(contactId, subject, body(lead.summary), "MEDIUM");
        kind = "crm_task";
      }
    } else if (summary.outcome !== "transferred" && summary.outcome !== "booked") {
      const priority = intentId === "commercial" || intentId === "existing_customer" ? "HIGH" : "MEDIUM";
      recordId = await createTask(contactId, `Call back: ${who} (${label})`, body(lead.summary ?? summary.routeReason), priority);
      kind = "crm_task";
    }
    if (recordId && kind) await recordAction(callId, kind, "ok", { id: recordId });
    await mergeLead({ call_id: callId, client_id: c.client_id, hubspot_contact_id: contactId, hubspot_record_id: recordId ?? undefined });

    // Existing customer after hours: the spec asks for the assigned PM to be notified.
    // There is no PM directory, so the notice goes to the ops push channel with the PM's name.
    if (intentId === "existing_customer" && summary.outcome !== "transferred") {
      const topic = process.env[c.alerts.push.topic_env] ?? "";
      const res = await sendPush(topic, {
        title: `${c.business.short_name}: message for PM ${lead.pm_name ?? "(name not given)"}`,
        message: `${who} called about their project at ${lead.property_address ?? "unknown address"}. ${lead.summary ?? ""}`,
        priority: "default",
        tags: ["construction"],
      });
      await recordAction(callId, "push", res.ok ? "ok" : "failed", { purpose: "notify PM", ...res });
    }
  } catch (err) {
    await recordAction(callId, "crm_contact", "failed", { error: (err as Error).message });
    await logError("hubspot", (err as Error).message, callId);
  }
}

