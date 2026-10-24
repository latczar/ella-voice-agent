"use client";

// A table row that opens the call's detail page, with a real link for keyboard users.
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export default function CallRow({ id, children }: { id: string; children: ReactNode }) {
  const router = useRouter();
  const href = `/calls/${encodeURIComponent(id)}`;
  return (
    <tr className="row-link" onClick={() => router.push(href)} onKeyDown={(e) => e.key === "Enter" && router.push(href)} tabIndex={0} aria-label="Open call">
      {children}
    </tr>
  );
}
