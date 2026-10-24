import Link from "next/link";
import { config, getLeads, intentLabel, siteInfo } from "@/lib/public-data";
import LiveRefresh from "../live-refresh";
import { Badge, Dash, PageHead, When } from "../ui";
import { NewBadge, Row, SeenScope } from "../new-rows";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads · Ella console" };

export default async function LeadsPage() {
  const c = config();
  const site = siteInfo();
  const leads = await getLeads();
  return (
    <main className="page">
      <PageHead
        title="Leads"
        sub="Details Ella captured, as sent to HubSpot. Real callers' details are masked here; demo and test leads are shown in full."
        right={<LiveRefresh />}
      />
      <section className="card">
        <SeenScope scope="leads" ids={leads.map((l) => l.call_id)}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-time">Captured (CT)</th><th>Name</th><th className="hide-sm hide-md">Phone</th><th className="hide-sm">Property</th><th>Intent</th>
                <th className="col-status hide-sm">Need</th><th className="col-status hide-sm hide-md">Follow-up</th><th className="right col-tags"><span className="sr-only">Call</span></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <Row key={l.call_id} id={l.call_id}>
                  <td className="cell-time"><When iso={l.created_at} timezone={site.timezone} /> <NewBadge id={l.call_id} /></td>
                  <td>{l.full_name ?? <Dash />}{l.company_name && <div className="faint">{l.company_name}</div>}</td>
                  <td className="mono nowrap hide-sm hide-md">{l.phone ?? <Dash />}</td>
                  <td className="hide-sm cell-wrap">
                    {l.property_address ?? <Dash />}
                    {l.property_type && <div className="faint" style={{ textTransform: "capitalize" }}>{l.property_type}</div>}
                  </td>
                  <td className="cell-main">{intentLabel(c, l.intent)}</td>
                  <td className="hide-sm">{l.urgency === "emergency" ? <Badge tone="warn">Emergency</Badge> : l.caller_need ? <Badge tone="neutral" plain>{l.caller_need}</Badge> : <Dash />}</td>
                  <td className="hide-sm hide-md">{l.callback_requested ? <Badge tone="info">Call-back</Badge> : <Dash />}</td>
                  <td className="right cell-actions">
                    {!l.visible && <span className="tag">Redacted</span>} <Link className="link" href={`/calls/${encodeURIComponent(l.call_id)}`}>Call</Link>
                  </td>
                </Row>
              ))}
              {leads.length === 0 && <tr><td colSpan={8} className="empty">No leads yet.</td></tr>}
            </tbody>
          </table>
        </div>
        </SeenScope>
      </section>
    </main>
  );
}
