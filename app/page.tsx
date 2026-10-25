// Overview: how to reach Ella, headline numbers, recent calls and system health.
import Link from "next/link";
import {
  config, departmentName, formatCost, formatDuration, formatUsNumber, formatWhen, getCalls, getErrors, getHealth,
  intentLabel, siteInfo,
} from "@/lib/public-data";
import TalkToElla from "./talk-to-ella";
import { Badge, CallTags, OutcomeBadge, PageHead, Stat, When } from "./ui";
import CallRow from "./call-row";
import LiveRefresh from "./live-refresh";
import { NewBadge, SeenScope } from "./new-rows";

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

  const transferred = count("transferred");

  return (
    <main className="page">
      <PageHead
        title="Overview"
        sub={`${site.agentName} answers every call to ${site.businessName}, day and night: questions, lead capture, transfers, bookings and emergency alerts.`}
        right={<LiveRefresh />}
      />

      <div className="seams reach" id="talk">
        <section aria-labelledby="call-heading">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h2 id="call-heading">Talk to {site.agentName}</h2>
            <Badge tone="ok">Answering now</Badge>
          </div>
          <div>
            <div className="muted">Phone (US)</div>
            <div className="reading">{site.number ? <a href={`tel:${site.number}`}>{formatUsNumber(site.number)}</a> : "Not provisioned"}</div>
          </div>
          <p className="reach-note">
            Transfers reach stand-in team members (for example Sam in Residential Sales), so you can hear the full hand-off.
          </p>
          <div className="notice">Please use made-up details. Everything here is synthetic or from test calls.</div>
        </section>
        <section aria-labelledby="browser-heading">
          <h2 id="browser-heading">Or in your browser</h2>
          {site.assistantId ? <TalkToElla assistantId={site.assistantId} agentName={site.agentName} /> : <div className="notice">Not provisioned yet.</div>}
        </section>
      </div>

      <div className="seams figures" aria-label="Last 7 days">
        <Stat label="Calls, 7 days" value={week.length} />
        <Stat label="Transferred" value={transferred} note={week.length ? `${Math.round((transferred / week.length) * 100)}% of calls` : undefined} />
        <Stat label="Booked or call-back" value={count("booked") + count("callback")} />
        <Stat label="Emergency alerts" value={count("sms_sent") + week.filter((x) => x.intent === "emergency" && x.outcome === "transferred").length} />
        <Stat label="Average duration" value={formatDuration(avgDuration)} note="minutes:seconds" />
        <Stat label="Average cost" value={formatCost(avgCost)} note="per call, Vapi" />
      </div>

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Recent calls</h2>
            <Link className="link" href="/calls">All calls</Link>
          </div>
          <SeenScope scope="overview-calls" ids={calls.slice(0, 8).map((x) => x.id)}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-time">Time (CT)</th><th>Intent</th><th className="col-status">Outcome</th>
                    <th className="right col-num">Duration</th><th className="right col-tags hide-sm"><span className="sr-only">Tags</span></th>
                  </tr>
                </thead>
                <tbody>
                  {calls.slice(0, 8).map((x) => (
                    <CallRow key={x.id} id={x.id}>
                      <td className="cell-time"><When iso={x.started_at} timezone={site.timezone} /> <NewBadge id={x.id} /></td>
                      <td className="cell-main">{intentLabel(c, x.intent)}<div className="sub hide-sm">{departmentName(c, x.route)}</div></td>
                      <td><OutcomeBadge outcome={x.outcome} /></td>
                      <td className="right measured">{formatDuration(x.duration_s)}</td>
                      <td className="right nowrap hide-sm"><CallTags isDemo={x.is_demo} isTest={x.is_test} redacted={x.redacted} /></td>
                    </CallRow>
                  ))}
                  {calls.length === 0 && <tr><td colSpan={5} className="empty">No calls yet. Ring the number above or start a browser call.</td></tr>}
                </tbody>
              </table>
            </div>
          </SeenScope>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Health</h2></div>
          <div className="panel-body">
            <dl className="kv kv-tight">
              <dt>Last successful call</dt>
              <dd className="measured">{formatWhen(health?.last_successful_call_at ?? null, site.timezone)}</dd>
              <dt>Calls, last 7 days</dt>
              <dd className="measured">{health?.calls_7d ?? 0}</dd>
              <dt>Failed transfers, 7 days</dt>
              <dd>{health?.failed_transfers_7d ? <Badge tone="bad">{health.failed_transfers_7d}</Badge> : <Badge tone="ok">0</Badge>}</dd>
              <dt>Webhook errors, 24 hours</dt>
              <dd>{health?.errors_24h ? <Badge tone="warn">{health.errors_24h}</Badge> : <Badge tone="ok">0</Badge>}</dd>
              {site.statusPageUrl && (
                <>
                  <dt>Uptime</dt>
                  <dd><a href={site.statusPageUrl} target="_blank" rel="noreferrer">Status page</a></dd>
                </>
              )}
            </dl>
            {errors.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ marginBottom: 6 }}>Recent errors</h3>
                {errors.map((e) => (
                  <div key={e.id} className="error-row">
                    <div><span className="measured">{formatWhen(e.created_at, site.timezone)}</span> <span className="tag">{e.source}</span></div>
                    <div className="muted">{e.message.slice(0, 140)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
