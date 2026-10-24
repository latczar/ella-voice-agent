import { config, departmentName, formatCost, formatDuration, formatWhen, getCalls, intentLabel, siteInfo } from "@/lib/public-data";
import CallRow from "../call-row";
import { CallTags, OutcomeBadge, PageHead } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calls · Ella console" };

export default async function CallsPage() {
  const c = config();
  const site = siteInfo();
  const calls = await getCalls(200);
  return (
    <main className="page">
      <PageHead title="Calls" sub="Every call Ella has handled, newest first. Times are US Central." />
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time (CT)</th><th>Channel</th><th>Intent</th><th>Route</th><th>Outcome</th>
                <th className="right">Duration</th><th className="right">Cost</th><th></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((x) => (
                <CallRow key={x.id} id={x.id}>
                  <td className="nowrap num">{formatWhen(x.started_at, site.timezone)}</td>
                  <td className="muted">{x.channel === "web" ? "Browser" : x.channel === "chat" ? "Chat" : "Phone"}</td>
                  <td>{intentLabel(c, x.intent)}</td>
                  <td className="muted">{departmentName(c, x.route)}</td>
                  <td><OutcomeBadge outcome={x.outcome} /></td>
                  <td className="right num">{formatDuration(x.duration_s)}</td>
                  <td className="right num">{formatCost(x.cost_usd)}</td>
                  <td className="right"><CallTags isDemo={x.is_demo} isTest={x.is_test} redacted={x.redacted} /></td>
                </CallRow>
              ))}
              {calls.length === 0 && <tr><td colSpan={8} className="empty">No calls yet. Call Ella or start a browser call from the overview.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
