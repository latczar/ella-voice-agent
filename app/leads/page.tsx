import Link from "next/link";
import { config, formatWhen, getLeads, intentLabel, siteInfo } from "@/lib/public-data";
import { Badge, PageHead } from "../ui";

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
      />
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Captured (CT)</th><th>Name</th><th>Phone</th><th>Property</th><th>Intent</th><th>Need</th><th>Follow-up</th><th></th></tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.call_id}>
                  <td className="nowrap num">{formatWhen(l.created_at, site.timezone)}</td>
                  <td>{l.full_name ?? <span className="faint">—</span>}{l.company_name && <div className="faint">{l.company_name}</div>}</td>
                  <td className="mono nowrap">{l.phone ?? <span className="faint">—</span>}</td>
                  <td>
                    {l.property_address ?? <span className="faint">—</span>}
                    {l.property_type && <div className="faint" style={{ textTransform: "capitalize" }}>{l.property_type}</div>}
                  </td>
                  <td>{intentLabel(c, l.intent)}</td>
                  <td>{l.urgency === "emergency" ? <Badge tone="warn">Emergency</Badge> : l.caller_need ?? "—"}</td>
                  <td>{l.callback_requested ? <Badge tone="info">Call-back</Badge> : <span className="faint">—</span>}</td>
                  <td className="right">
                    {!l.visible && <span className="tag">Redacted</span>} <Link className="link" href={`/calls/${encodeURIComponent(l.call_id)}`}>Call</Link>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={8} className="empty">No leads yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
