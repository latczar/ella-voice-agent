"use client";

// "Talk to Ella": a browser call through the Vapi Web SDK, with a live transcript.
// Uses the public key only. Hand-offs to the department assistants work here too.

import Vapi from "@vapi-ai/web";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "live" | "ended" | "error";
interface Line {
  agent: boolean;
  text: string;
}

export default function TalkToElla({ assistantId, agentName }: { assistantId: string; agentName: string }) {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const vapi = useRef<Vapi | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!publicKey) return;
    const v = new Vapi(publicKey);
    v.on("call-start", () => setStatus("live"));
    v.on("call-end", () => { setStatus("ended"); setSpeaking(false); });
    v.on("speech-start", () => setSpeaking(true));
    v.on("speech-end", () => setSpeaking(false));
    v.on("error", (e: unknown) => {
      setStatus("error");
      setError(e instanceof Error ? e.message : "The call couldn't connect. Check microphone access and try again.");
    });
    v.on("message", (m: { type?: string; transcriptType?: string; role?: string; transcript?: string }) => {
      if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) {
        setLines((prev) => [...prev, { agent: m.role !== "user", text: m.transcript! }]);
      }
    });
    vapi.current = v;
    return () => { v.stop(); };
  }, [publicKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [lines]);

  if (!publicKey) return <div className="notice warn">Browser calls aren&apos;t configured on this deployment (missing Vapi public key).</div>;

  const start = async () => {
    setError(null);
    setLines([]);
    setStatus("connecting");
    try {
      await vapi.current?.start(assistantId);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  };
  const live = status === "connecting" || status === "live";

  return (
    <div className="call-panel">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className={`btn ${live ? "btn-danger" : "btn-primary"}`} onClick={live ? () => vapi.current?.stop() : start} disabled={status === "connecting"}>
          {status === "connecting" ? "Connecting…" : live ? "End call" : `Start browser call`}
        </button>
        {status === "live" && (
          <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="live-dot" /> {speaking ? `${agentName} is speaking` : "Listening"}
          </span>
        )}
        {status === "ended" && <span className="muted">Call ended. It will appear in Calls shortly.</span>}
      </div>
      {error && <div className="notice warn">{error}</div>}
      {lines.length > 0 && (
        <div className="card" style={{ boxShadow: "none" }}>
          <div className="card-body transcript" style={{ maxHeight: 280 }}>
            {lines.map((l, i) => (
              <div key={i} className={`turn${l.agent ? " agent" : ""}`}>
                <div className="turn-role">{l.agent ? agentName : "You"}</div>
                <div>{l.text}</div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>
      )}
    </div>
  );
}
