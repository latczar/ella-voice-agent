import { formatWhen, getLatestPerPersona, siteInfo } from "@/lib/public-data";
import { ESTIMATED_COST_PER_PERSONA_USD, loadPersonas } from "@/lib/persona-runner";
import { Badge, PageHead, Stat, Transcript, When } from "../ui";
import LiveRefresh from "../live-refresh";
import { NewBadge, NewDetails, SeenScope } from "../new-rows";
import RunTestsPanel from "./run-tests-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tests, Ella console" };

export default async function TestsPage() {
  const site = siteInfo();
  const results = await getLatestPerPersona();
  const personaCount = loadPersonas().length;
  const passed = results.filter((r) => r.passed).length;
  const lastTested = results.reduce<string | null>((max, r) => (!max || r.started_at > max ? r.started_at : max), null);
  const key = (r: { run_id: string; persona: string }) => `${r.run_id}:${r.persona}`;

  return (
    <main className="page">
      <PageHead
        title="Tests"
        sub="An AI caller plays each scenario against the staging assistant, by text. Each scenario shows its latest result, the checks and the transcript as evidence."
        right={<LiveRefresh />}
      />
      <div className="gap-below">
        <RunTestsPanel personaCount={personaCount} costEach={ESTIMATED_COST_PER_PERSONA_USD} />
      </div>
      {!results.length ? (
        <section className="panel"><div className="empty">No test runs yet. Results appear here after the first run.</div></section>
      ) : (
        <>
          <div className="seams figures figures-3">
            <Stat label="Last tested (CT)" value={formatWhen(lastTested, site.timezone)} />
            <Stat label="Scenarios passing" value={`${passed} / ${results.length}`} />
            <Stat label="Result" value={passed === results.length ? <Badge tone="ok">All passed</Badge> : <Badge tone="bad">{results.length - passed} failed</Badge>} />
          </div>
          <SeenScope scope="tests" ids={results.map(key)}>
            <section className="panel result-list">
              <div className="result-row result-head" aria-hidden>
                <span>Scenario</span><span className="hide-sm">Last run (CT)</span><span className="right">Checks</span><span className="right">Result</span>
              </div>
              {results.map((r) => {
                const ok = r.assertions.filter((a) => a.passed).length;
                return (
                  <NewDetails key={r.persona} id={key(r)} className="result">
                    <summary className="result-row">
                      <span className="result-name">{r.persona} <NewBadge id={key(r)} /></span>
                      <span className="hide-sm measured" style={{ color: "var(--color-cool)" }}><When iso={r.started_at} timezone={site.timezone} /></span>
                      <span className="right measured">{ok}/{r.assertions.length}</span>
                      <span className="right">{r.passed ? <Badge tone="ok">Pass</Badge> : <Badge tone="bad">Fail</Badge>}</span>
                    </summary>
                    <div className="result-body halves">
                      <div>
                        <h3 style={{ marginBottom: 8 }}>Checks</h3>
                        {r.assertions.map((a) => (
                          <div key={a.name} className="check">
                            <Badge tone={a.passed ? "ok" : "bad"}>{a.passed ? "Pass" : "Fail"}</Badge>
                            <div>
                              <div>{a.name}</div>
                              {a.detail && <div className="sub">{a.detail}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <h3 style={{ marginBottom: 8 }}>Transcript</h3>
                        {r.transcript ? <Transcript text={r.transcript} agentName={site.agentName} /> : <span className="muted">None stored.</span>}
                      </div>
                    </div>
                  </NewDetails>
                );
              })}
            </section>
          </SeenScope>
        </>
      )}
    </main>
  );
}
