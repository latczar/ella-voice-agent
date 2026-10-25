import { config, departmentName, formatCost, formatDuration, getCalls, intentLabel, siteInfo } from "@/lib/public-data";
import CallRow from "../call-row";
import { CallTags, OutcomeBadge, PageHead, When } from "../ui";
import LiveRefresh from "../live-refresh";
import { NewBadge, SeenScope } from "../new-rows";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calls, Ella console" };

export default async function CallsPage() {
  const c = config();
  const site = siteInfo();
  const calls = await getCalls(200);
  return (
    <main className="page">
      <PageHead title="Calls" sub={`Every call Ella has handled, newest first (${calls.length} shown). Times are US Central.`} right={<LiveRefresh />} />
      <section className="panel">
        <SeenScope scope="calls" ids={calls.map((x) => x.id)}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-time">Time (CT)</th><th className="hide-sm hide-md">Channel</th><th>Intent</th><th className="hide-sm hide-md">Route</th><th className="col-status">Outcome</th>
                <th className="right col-num hide-sm">Duration</th><th className="right col-num hide-sm">Cost</th><th className="right col-tags hide-sm"><span className="sr-only">Tags</span></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((x) => (
                <CallRow key={x.id} id={x.id}>
                  <td className="cell-time"><When iso={x.started_at} timezone={site.timezone} /> <NewBadge id={x.id} /></td>
                  <td className="muted hide-sm hide-md">{x.channel === "web" ? "Browser" : x.channel === "chat" ? "Chat" : "Phone"}</td>
                  <td className="cell-main">{intentLabel(c, x.intent)}</td>
                  <td className="muted hide-sm hide-md">{departmentName(c, x.route)}</td>
                  <td><OutcomeBadge outcome={x.outcome} /></td>
                  <td className="right measured hide-sm">{formatDuration(x.duration_s)}</td>
                  <td className="right measured hide-sm">{formatCost(x.cost_usd)}</td>
                  <td className="right nowrap hide-sm"><CallTags isDemo={x.is_demo} isTest={x.is_test} redacted={x.redacted} /></td>
                </CallRow>
              ))}
              {calls.length === 0 && <tr><td colSpan={8} className="empty">No calls yet. Call Ella or start a browser call from the overview.</td></tr>}
            </tbody>
          </table>
        </div>
        </SeenScope>
      </section>
    </main>
  );
}
