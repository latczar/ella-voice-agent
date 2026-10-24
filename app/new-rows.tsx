"use client";

// Marks rows that live refresh brought in since this viewer last looked: a "New" badge and a
// highlight that fades. Seen IDs are kept per viewer in localStorage (in memory if that's
// blocked). On a viewer's first visit everything counts as seen, so nothing flashes.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const MAX_REMEMBERED = 500;
const memory = new Map<string, string[]>();

function readSeen(scope: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(`ella:seen:${scope}`);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* storage blocked or corrupt: fall back to memory */ }
  return memory.get(scope) ?? null;
}

function writeSeen(scope: string, ids: string[]): void {
  const kept = ids.slice(-MAX_REMEMBERED);
  memory.set(scope, kept);
  try { window.localStorage.setItem(`ella:seen:${scope}`, JSON.stringify(kept)); } catch { /* memory copy is enough */ }
}

const NewIds = createContext<ReadonlySet<string>>(new Set());

export function SeenScope({ scope, ids, children }: { scope: string; ids: string[]; children: ReactNode }) {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join("|");

  useEffect(() => {
    const seen = readSeen(scope);
    if (!seen) {
      writeSeen(scope, ids);
      return;
    }
    const known = new Set(seen);
    const added = ids.filter((id) => !known.has(id));
    if (!added.length) return;
    writeSeen(scope, [...seen, ...added]);
    setFresh((prev) => new Set([...prev, ...added]));
    // ids is read through key, so the effect reruns only when the set of rows changes.
  }, [scope, key]);

  return <NewIds.Provider value={fresh}>{children}</NewIds.Provider>;
}

export function useIsNew(id: string): boolean {
  return useContext(NewIds).has(id);
}

export function NewBadge({ id }: { id: string }) {
  return useIsNew(id) ? <span className="new-badge">New</span> : null;
}

/** A table row that highlights when new and, with href, opens a page (with a real link for keyboard users). */
export function Row({ id, href, label, children }: { id: string; href?: string; label?: string; children: ReactNode }) {
  const router = useRouter();
  const isNew = useIsNew(id);
  const cls = [href ? "row-link" : "", isNew ? "row-new" : ""].filter(Boolean).join(" ") || undefined;
  if (!href) return <tr className={cls}>{children}</tr>;
  return (
    <tr className={cls} onClick={() => router.push(href)} onKeyDown={(e) => e.key === "Enter" && router.push(href)} tabIndex={0} aria-label={label}>
      {children}
    </tr>
  );
}

/** A collapsible card that highlights when new. */
export function NewDetails({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const isNew = useIsNew(id);
  return <details className={`${className ?? ""}${isNew ? " row-new" : ""}`}>{children}</details>;
}
