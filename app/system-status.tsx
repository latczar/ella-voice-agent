"use client";

// Live system status: polls /api/health while the tab is visible (the same check the
// BetterStack monitor runs) and links to the public status page. Free to poll: the
// health check reads the database only, never Vapi. Chip classes match ui.tsx's Badge,
// which can't be imported here (it pulls in server-only code).

import { useEffect, useState } from "react";

type State = "checking" | "up" | "down";

export default function SystemStatus({ statusPageUrl, everyMs = 30_000 }: { statusPageUrl: string | null; everyMs?: number }) {
  const [state, setState] = useState<State>("checking");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean };
        if (!cancelled) setState(res.ok && json.ok ? "up" : "down");
      } catch {
        if (!cancelled) setState("down");
      }
      if (!cancelled) setCheckedAt(new Date().toLocaleTimeString());
    };
    check();
    const poll = setInterval(check, everyMs);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", check);
    };
  }, [everyMs]);

  const title = checkedAt ? `Health check at ${checkedAt}; rechecks every ${everyMs / 1000}s` : "Running the health check";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title={title}>
      {state === "up" && <span className="chip c-ok">Answering now</span>}
      {state === "down" && <span className="chip c-bad">System problem</span>}
      {state === "checking" && <span className="chip c-neutral">Checking…</span>}
      {statusPageUrl && (
        <a className="btn btn-sm" href={statusPageUrl} target="_blank" rel="noreferrer">
          Status page ↗
        </a>
      )}
    </span>
  );
}
