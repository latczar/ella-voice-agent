"use client";

// Keeps a server-rendered page current: re-fetches its data every few seconds while the tab is
// visible, and on demand when a browser call ends (the "calls-changed" event). Plain polling:
// the public views aren't realtime tables, and a refresh every 10 s is cheap.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export const CALLS_CHANGED = "ella:calls-changed";

export default function LiveRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setUpdatedAt(Date.now());
    };
    const poll = setInterval(refresh, everyMs);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(CALLS_CHANGED, refresh);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(CALLS_CHANGED, refresh);
    };
  }, [router, everyMs]);

  const ago = Math.max(0, Math.round((now - updatedAt) / 1000));
  return (
    <span className="live-pill" title="This page updates itself every few seconds">
      <span className="live-dot" /> Live · updated {ago < 2 ? "just now" : `${ago}s ago`}
    </span>
  );
}
