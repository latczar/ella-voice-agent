import Link from "next/link";
import { notFound } from "next/navigation";
import {
  config, departmentName, formatCost, formatDuration, formatWhen, getActions, getCall, getLead, intentLabel, siteInfo,
} from "@/lib/public-data";
import { Badge, CallTags, OutcomeBadge, Transcript } from "../../ui";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  sms: "Dispatch text", push: "Push alert", booking: "Inspection booked", crm_contact: "HubSpot contact",
  crm_task: "HubSpot task", crm_ticket: "HubSpot ticket (billing queue)", email: "Email", transfer: "Transfer",
};

const LEAD_FIELDS: [string, string][] = [
  ["full_name", "Name"], ["phone", "Phone"], ["email", "Email"], ["property_address", "Property address"],
  ["property_type", "Property type"], ["caller_need", "Caller need"], ["company_name", "Company"],
  ["facility_type", "Facility type"], ["roof_size_or_buildings", "Roof size or buildings"], ["pm_name", "Project manager"],
  ["invoice_or_account_number", "Invoice or account"], ["urgency", "Urgency"],
];

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = config();
  const site = siteInfo();
  const [call, lead, actions] = await Promise.all([getCall(decodeURIComponent(id)), getLead(decodeURIComponent(id)), getActions(decodeURIComponent(id))]);
  if (!call) notFound();

  const channel = call.channel === "web" ? "Browser" : call.channel === "chat" ? "Chat" : "Phone";

  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/calls">Calls</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">This call</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>{intentLabel(c, call.intent)}</h1>
          <dl className="facts">
            <div><dt>Started (CT)</dt><dd>{formatWhen(call.started_at, site.timezone)}</dd></div>
            <div><dt>Duration</dt><dd>{formatDuration(call.duration_s)}</dd></div>
            <div><dt>Cost</dt><dd>{formatCost(call.cost_usd)}</dd></div>
            <div><dt>Channel</dt><dd>{channel}</dd></div>
          </dl>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <CallTags isDemo={call.is_demo} isTest={call.is_test} redacted={call.redacted} />
          <OutcomeBadge outcome={call.outcome} />
        </div>
      </div>

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Transcript</h2>
            {call.recording_url && <a className="link" href={call.recording_url} target="_blank" rel="noreferrer">Open recording</a>}
          </div>
          <div className="panel-body">
            {call.recording_url && <audio controls preload="none" src={call.recording_url} style={{ width: "100%", marginBottom: 16 }} />}
            {call.redacted ? (
              <div className="notice">This was a real call, so its transcript, summary and recording are hidden on the public dashboard.</div>
            ) : call.transcript ? (
              <Transcript text={call.transcript} agentName={site.agentName} />
            ) : (
              <div className="muted">No transcript stored for this call.</div>
            )}
          </div>
        </section>

        <div className="seams" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          {call.summary && (
            <section className="panel-body">
              <h3 style={{ marginBottom: 6 }}>Summary</h3>
              <p>{call.summary}</p>
            </section>
          )}
          <section className="panel-body">
            <h3 style={{ marginBottom: 8 }}>Route</h3>
            <dl className="kv">
              <dt>Routed to</dt><dd>{departmentName(c, call.route)}</dd>
              <dt>Reason</dt><dd>{call.route_reason ?? "None given"}</dd>
              <dt>Ended</dt><dd className="mono">{call.ended_reason ?? "Not recorded"}</dd>
            </dl>
          </section>
          <section className="panel-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <h3>Captured details</h3>
              {lead?.callback_requested && <Badge tone="info">Call-back requested</Badge>}
            </div>
            {lead ? (
              <dl className="kv">
                {LEAD_FIELDS.filter(([k]) => lead[k as keyof typeof lead]).map(([k, label]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{label}</dt><dd>{String(lead[k as keyof typeof lead])}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="muted">No lead captured on this call.</div>
            )}
          </section>
          <section className="panel-body">
            <h3 style={{ marginBottom: 8 }}>Actions</h3>
            {actions.length ? (
              <div className="list-rows">
                {actions.map((a) => (
                  <div key={a.id}>
                    <span>{ACTION_LABELS[a.kind] ?? a.kind}</span>
                    <Badge tone={a.status === "ok" ? "ok" : a.status === "failed" ? "bad" : "neutral"}>{a.status === "ok" ? "Done" : a.status === "failed" ? "Failed" : "Skipped"}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No alerts, bookings or CRM records for this call.</div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
