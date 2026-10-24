import { formatWhen, getLatestTestRun, siteInfo } from "@/lib/public-data";
import { Badge, PageHead, Stat, Transcript } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tests · Ella console" };

export default async function TestsPage() {
  const site = siteInfo();
  const results = await getLatestTestRun();
  const run = results[0];
  const passed = results.filter((r) => r.passed).length;

  return (
    <main className="page">
      <PageHead
        title="Tests"
        sub="Automated caller personas run against the staging assistant. Each result shows its assertions and the transcript as evidence."
      />
      {!run ? (
        <section className="card"><div className="empty">No test runs yet.</div></section>
      ) : (
        <>
          <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 16 }}>
            <Stat label="Latest run" value={<span style={{ fontSize: 16 }}>{formatWhen(run.started_at, site.timezone)} CT</span>} />
            <Stat label="Personas passed" value={`${passed} / ${results.length}`} />
            <Stat label="Result" value={passed === results.length ? <Badge tone="ok">All passed</Badge> : <Badge tone="bad">{results.length - passed} failed</Badge>} />
          </div>
          <div className="grid">
            {results.map((r) => (
              <details key={r.persona} className="card">
                <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
                  <h2>{r.persona}</h2>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="faint num">{r.assertions.filter((a) => a.passed).length}/{r.assertions.length} checks</span>
                    {r.passed ? <Badge tone="ok">Pass</Badge> : <Badge tone="bad">Fail</Badge>}
                  </span>
                </summary>
                <div className="card-body grid grid-halves">
                  <div>
                    <h3 style={{ marginBottom: 8 }}>Assertions</h3>
                    {r.assertions.map((a) => (
                      <div key={a.name} style={{ display: "flex", gap: 10, padding: "5px 0", borderTop: "1px solid var(--border)" }}>
                        <Badge tone={a.passed ? "ok" : "bad"} plain>{a.passed ? "Pass" : "Fail"}</Badge>
                        <div>
                          <div>{a.name}</div>
                          {a.detail && <div className="faint" style={{ fontSize: 12 }}>{a.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3 style={{ marginBottom: 8 }}>Transcript</h3>
                    {r.transcript ? <Transcript text={r.transcript} agentName={site.agentName} /> : <span className="muted">None stored.</span>}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
