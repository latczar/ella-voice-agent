// Small presentational pieces shared by the dashboard pages.
import type { ReactNode } from "react";
import { OUTCOMES } from "@/lib/public-data";

export function Badge({ tone = "neutral", children, plain }: { tone?: "ok" | "warn" | "bad" | "info" | "neutral"; children: ReactNode; plain?: boolean }) {
  return <span className={`badge b-${tone}${plain ? " plain" : ""}`}>{children}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const o = OUTCOMES[outcome ?? ""] ?? { label: outcome ?? "In progress", tone: "neutral" as const };
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export function CallTags({ isDemo, isTest, redacted }: { isDemo: boolean; isTest: boolean; redacted: boolean }) {
  return (
    <>
      {isDemo && <span className="tag">Demo</span>}
      {isTest && <span className="tag">Test</span>}
      {redacted && <span className="tag" title="Real call: personal details hidden">Redacted</span>}
    </>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Splits Vapi's plain-text transcript ("AI: ...\nUser: ...") into turns. */
export function Transcript({ text, agentName }: { text: string; agentName: string }) {
  const turns = text
    .split(/\n+/)
    .map((line) => line.match(/^(AI|Assistant|Bot|User|Customer):\s*(.*)$/i))
    .filter((m): m is RegExpMatchArray => Boolean(m && m[2]))
    .map((m) => ({ agent: !/^(user|customer)$/i.test(m[1]), text: m[2] }));
  if (!turns.length) return <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>;
  return (
    <div className="transcript">
      {turns.map((t, i) => (
        <div key={i} className={`turn${t.agent ? " agent" : ""}`}>
          <div className="turn-role">{t.agent ? agentName : "Caller"}</div>
          <div>{t.text}</div>
        </div>
      ))}
    </div>
  );
}
