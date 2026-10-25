"use client";

// "Sanity checks" control: runs the free checks (lib/server/sanity-checks.ts) and shows them
// grouped. No passcode: they spend no Vapi credit and write nothing.

import { useState } from "react";

type Check = { group: string; name: string; passed: boolean; detail?: string };
type Report = { passed: number; failed: number; ms: number; checks: Check[]; at: string };

export default function SanityPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function run() {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tests/sanity", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `The server returned ${res.status}. Try again in a minute.`);
      setReport({ ...json, at: new Date().toLocaleTimeString() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button className="btn" onClick={run}>Sanity checks (free)</button>;

  const groups = report ? [...new Set(report.checks.map((c) => c.group))] : [];
  return (
    <section className="panel run-panel" aria-live="polite">
      <div className="panel-head">
        <h2>Sanity checks</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" onClick={run} disabled={busy}>{busy ? "Checking…" : "Run again"}</button>
          {!busy && <button className="btn btn-sm" onClick={() => setOpen(false)}>Close</button>}
        </div>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 12 }}>
        <p className="muted">
          Free: no calls or chats, so no Vapi credit is spent and nothing is written. Checks the client config, every scenario file,
          that the live assistants on Vapi match the prompts in the repo, that the webhooks refuse unsigned requests, and that the
          database and integrations are set up.
        </p>
        {busy && !report && <div className="notice">Checking… this takes a few seconds.</div>}
        {error && <div className="notice bad" role="alert">{error}</div>}
        {report && (
          <>
            <div className={report.failed ? "notice bad" : "notice"}>
              {report.failed ? `${report.failed} of ${report.checks.length} checks failed.` : `All ${report.checks.length} checks passed.`} Checked at {report.at} in {(report.ms / 1000).toFixed(1)} s.
            </div>
            {groups.map((g) => (
              <div key={g}>
                <h3 style={{ marginBottom: 8 }}>{g}</h3>
                {report.checks.filter((c) => c.group === g).map((c) => (
                  <div key={c.name} className="check">
                    <span className={`chip c-${c.passed ? "ok" : "bad"}`}>{c.passed ? "Pass" : "Fail"}</span>
                    <div>
                      <div>{c.name}</div>
                      {c.detail && <div className="sub">{c.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
