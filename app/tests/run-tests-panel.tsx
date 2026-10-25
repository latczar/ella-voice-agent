"use client";

// "Run tests" control: pick the scenarios, enter the admin passcode, see the cost, then it steps
// through them one request at a time (Vercel functions have a time limit), showing each result live.
// The server checks the passcode, allows one run at a time and enforces a cooldown.

import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = { file: string; name: string; status: "waiting" | "running" | "passed" | "failed" | "error"; note?: string; cost?: number };
type Result = { passed: boolean; cost: number; checks: { name: string; passed: boolean }[]; error?: string };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/tests/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `The server returned ${res.status}. Try again in a minute.`);
  return json as T;
}

const STATUS: Record<Step["status"], { label: string; tone: "ok" | "bad" | "info" | "neutral" | "warn" }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  passed: { label: "Pass", tone: "ok" },
  failed: { label: "Fail", tone: "bad" },
  error: { label: "Error", tone: "warn" },
};

export type ScenarioOption = { file: string; name: string; lastPassed: boolean | null };

export default function RunTestsPanel({ scenarios, costEach }: { scenarios: ScenarioOption[]; costEach: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  // Credit is limited, so a run can be just the scenarios that need it.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scenarios.map((s) => s.file)));
  const pick = (keep: (s: ScenarioOption) => boolean) => setSelected(new Set(scenarios.filter(keep).map((s) => s.file)));
  const toggle = (file: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(file)) next.delete(file); else next.add(file);
    return next;
  });
  const count = selected.size;
  const estimate = `$${(count * costEach).toFixed(2)}`;

  const update = (file: string, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.file === file ? { ...x, ...patch } : x)));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !count) return;
    if (!window.confirm(`This runs ${count} test conversation${count === 1 ? "" : "s"} against the staging assistant. It spends about ${estimate} of Vapi credit and writes test records to HubSpot and Cal.com. Go ahead?`)) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setSteps([]);
    let runId: string | null = null;
    try {
      const start = await post<{ runId: string; personas: { file: string; name: string }[] }>({ action: "start", passcode, files: [...selected] });
      runId = start.runId;
      setSteps(start.personas.map((p) => ({ ...p, status: "waiting" })));
      let cost = 0;
      for (const p of start.personas) {
        update(p.file, { status: "running" });
        try {
          const { result } = await post<{ result: Result }>({ action: "persona", passcode, runId, file: p.file });
          cost += result.cost;
          const okChecks = result.checks.filter((c) => c.passed).length;
          update(p.file, result.error
            ? { status: "error", note: result.error.slice(0, 160) }
            : { status: result.passed ? "passed" : "failed", note: `${okChecks}/${result.checks.length} checks`, cost: result.cost });
          if (result.error && /\b402\b/.test(result.error)) throw new Error("Vapi is out of credit, so the run stopped. Top up in the Vapi dashboard.");
        } catch (err) {
          update(p.file, { status: "error", note: (err as Error).message.slice(0, 160) });
          if (/out of credit|passcode|timed out|already finished/i.test((err as Error).message)) throw err;
        }
      }
      const totals = await post<{ passed: number; failed: number }>({ action: "finish", passcode, runId });
      runId = null;
      setSummary(`${totals.passed} passed, ${totals.failed} failed. Vapi cost about $${cost.toFixed(2)}.`);
    } catch (err) {
      setError((err as Error).message);
      if (runId) await post({ action: "finish", passcode, runId }).catch(() => undefined);
    } finally {
      setSteps((s) => s.map((x) => (x.status === "waiting" || x.status === "running" ? { ...x, status: "error", note: "Not run" } : x)));
      setBusy(false);
      router.refresh();
    }
  }

  if (!open) {
    return <button className="btn btn-primary" onClick={() => setOpen(true)}>Run tests</button>;
  }

  return (
    <section className="panel run-panel" aria-live="polite">
      <div className="panel-head">
        <h2>Run tests</h2>
        {!busy && <button className="btn btn-sm" onClick={() => setOpen(false)}>Close</button>}
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 12 }}>
        <p className="muted">
          Runs the chosen scenarios by text against the staging assistant, one at a time (about 30 seconds each).
          Each scenario costs about ${costEach.toFixed(2)} in Vapi credit and creates test records in HubSpot and Cal.com, so it needs the admin passcode.
          For a free check, use Sanity checks instead.
        </p>
        <fieldset className="scenario-pick" disabled={busy}>
          <legend className="sr-only">Scenarios to run</legend>
          <div className="scenario-quick">
            <span className="faint">Select:</span>
            <button type="button" className="btn btn-sm" onClick={() => pick(() => true)}>All</button>
            <button type="button" className="btn btn-sm" onClick={() => pick((s) => s.lastPassed !== true)}>Failed or never run</button>
            <button type="button" className="btn btn-sm" onClick={() => pick(() => false)}>None</button>
          </div>
          <div className="scenario-list">
            {scenarios.map((s) => (
              <label key={s.file} className="scenario-option">
                <input type="checkbox" checked={selected.has(s.file)} onChange={() => toggle(s.file)} />
                <span>{s.file.slice(0, 2)} {s.name}</span>
                <span className={`chip plain c-${s.lastPassed === null ? "neutral" : s.lastPassed ? "ok" : "bad"}`}>{s.lastPassed === null ? "Never run" : s.lastPassed ? "Passed" : "Failed"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <form onSubmit={run} className="run-form">
          <label className="sr-only" htmlFor="passcode">Admin passcode</label>
          <input id="passcode" className="input" type="password" autoComplete="current-password" placeholder="Admin passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} disabled={busy} required />
          <button className="btn btn-primary" type="submit" disabled={busy || !passcode || !count}>{busy ? "Running…" : count ? `Run ${count} test${count === 1 ? "" : "s"} (about ${estimate})` : "Pick at least one scenario"}</button>
        </form>
        {error && <div className="notice bad" role="alert">{error}</div>}
        {steps.length > 0 && (
          <ol className="run-steps">
            {steps.map((s) => (
              <li key={s.file}>
                <span className={s.status === "running" ? "spinner" : "spinner idle"} aria-hidden />
                <span className="run-name">{s.name}</span>
                <span className="faint num run-note">{s.note}{s.cost != null ? `, $${s.cost.toFixed(2)}` : ""}</span>
                <span className={`chip c-${STATUS[s.status].tone}`}>{STATUS[s.status].label}</span>
              </li>
            ))}
          </ol>
        )}
        {summary && <div className="notice">{summary} The results below are updated.</div>}
      </div>
    </section>
  );
}
