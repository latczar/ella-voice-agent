// Overview: how to reach Ella, headline numbers, recent calls and system health.
import Link from "next/link";
import {
  config, departmentName, formatCost, formatDuration, formatUsNumber, formatWhen, getCalls, getErrors, getHealth,
  intentLabel, siteInfo,
} from "@/lib/public-data";
import TalkToElla from "./talk-to-ella";
import { Badge, CallTags, OutcomeBadge, PageHead, Stat } from "./ui";
import CallRow from "./call-row";
import LiveRefresh from "./live-refresh";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const c = config();
  const site = siteInfo();
  const [calls, health, errors] = await Promise.all([getCalls(200), getHealth(), getErrors(5)]);

  const week = calls.filter((x) => x.started_at && Date.now() - Date.parse(x.started_at) < 7 * 864e5);
  const count = (o: string) => week.filter((x) => x.outcome === o).length;
  // Prefer calls that really happened (real and test) over the seeded demo figures once there are any.
  const realFirst = <T,>(xs: T[], isDemo: (x: T) => boolean) => (xs.some((x) => !isDemo(x)) ? xs.filter((x) => !isDemo(x)) : xs);
  const costed = realFirst(week.filter((x) => x.cost_usd != null), (x) => x.is_demo);
  const avgCost = costed.length ? costed.reduce((s, x) => s + (x.cost_usd ?? 0), 0) / costed.length : null;
  const timed = realFirst(week.filter((x) => x.duration_s != null), (x) => x.is_demo);
  const avgDuration = timed.length ? Math.round(timed.reduce((s, x) => s + (x.duration_s ?? 0), 0) / timed.length) : null;

  return (
    <main className="page">
      <PageHead
        title="Overview"
        sub={`${site.agentName} answers every call to ${site.businessName}, 24/7: questions, lead capture, transfers, bookings and emergency alerts.`}
        right={<LiveRefresh />}
      />

      <div className="grid grid-2" style={{ marginBottom: 16 }} id="talk">
        <section className="card">
          <div className="card-head">
            <h2>Talk to {site.agentName}</h2>
            <Badge tone="ok">Live</Badge>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 20 }}>
            <div>
              <div className="stat-label">Phone (US)</div>
              <div className="number">{site.number ? <a href={`tel:${site.number}`}>{formatUsNumber(site.number)}</a> : "Not provisioned"}</div>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Transfers reach stand-in team members (for example Sam in Residential Sales), so you can hear the full hand-off.
              </p>
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: 8 }}>Or in your browser</div>
              {site.assistantId ? <TalkToElla assistantId={site.assistantId} agentName={site.agentName} /> : <div className="notice">Not provisioned yet.</div>}
            </div>
            <div className="notice">Please use made-up details. Everything here is synthetic or from test calls.</div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Health</h2></div>
          <div className="card-body">
            <dl className="kv" style={{ gridTemplateColumns: "1fr auto" }}>
              <dt>Last successful call</dt>
              <dd className="num">{formatWhen(health?.last_successful_call_at ?? null, site.timezone)}</dd>
              <dt>Calls, last 7 days</dt>
              <dd className="num">{health?.calls_7d ?? 0}</dd>
              <dt>Failed transfers, 7 days</dt>
              <dd>{health?.failed_transfers_7d ? <Badge tone="bad">{health.failed_transfers_7d}</Badge> : <Badge tone="ok">0</Badge>}</dd>
              <dt>Webhook errors, 24 hours</dt>
              <dd>{health?.errors_24h ? <Badge tone="warn">{health.errors_24h}</Badge> : <Badge tone="ok">0</Badge>}</dd>
            </dl>
            {errors.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ marginBottom: 8 }}>Recent errors</h3>
                {errors.map((e) => (
                  <div key={e.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                    <div className="mono faint">{formatWhen(e.created_at, site.timezone)} · {e.source}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{e.message.slice(0, 140)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Calls (7 days)" value={week.length} />
        <Stat label="Transferred" value={count("transferred")} note={week.length ? `${Math.round((count("transferred") / week.length) * 100)}% of calls` : undefined} />
        <Stat label="Booked or call-back" value={count("booked") + count("callback")} />
        <Stat label="Emergency alerts" value={count("sms_sent") + week.filter((x) => x.intent === "emergency" && x.outcome === "transferred").length} />
        <Stat label="Avg duration · cost" value={<span>{formatDuration(avgDuration)} <span className="muted" style={{ fontSize: 15 }}>· {formatCost(avgCost)}</span></span>} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Recent calls</h2>
          <Link className="link" href="/calls">All calls</Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Time (CT)</th><th>Intent</th><th>Route</th><th>Outcome</th><th className="right">Duration</th><th className="right">Cost</th><th></th></tr>
            </thead>
            <tbody>
              {calls.slice(0, 8).map((x) => (
                <CallRow key={x.id} id={x.id}>
                  <td className="nowrap num">{formatWhen(x.started_at, site.timezone)}</td>
                  <td>{intentLabel(c, x.intent)}</td>
                  <td className="muted">{departmentName(c, x.route)}</td>
                  <td><OutcomeBadge outcome={x.outcome} /></td>
                  <td className="right num">{formatDuration(x.duration_s)}</td>
                  <td className="right num">{formatCost(x.cost_usd)}</td>
                  <td className="right"><CallTags isDemo={x.is_demo} isTest={x.is_test} redacted={x.redacted} /></td>
                </CallRow>
              ))}
              {calls.length === 0 && <tr><td colSpan={7} className="empty">No calls yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
