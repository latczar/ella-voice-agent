"use client";

// A table row that opens the call's detail page, with a real link for keyboard users.
// Highlights itself when live refresh has just brought it in (see new-rows.tsx).
import type { ReactNode } from "react";
import { Row } from "./new-rows";

export default function CallRow({ id, children }: { id: string; children: ReactNode }) {
  return <Row id={id} href={`/calls/${encodeURIComponent(id)}`} label="Open call">{children}</Row>;
}
