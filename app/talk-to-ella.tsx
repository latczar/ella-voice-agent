"use client";

// "Talk to Ella": a browser call through the Vapi Web SDK, with a live transcript.
// Uses the public key only. Hand-offs to the department assistants work here too.

import Vapi from "@vapi-ai/web";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "live" | "ended" | "error";
interface Line {
  role: string;
  text: string;
}

export default function TalkToElla({ assistantId, agentName }: { assistantId: string; agentName: string }) {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const vapi = useRef<Vapi | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!publicKey) return;
    const v = new Vapi(publicKey);
    v.on("call-start", () => setStatus("live"));
    v.on("call-end", () => setStatus("ended"));
    v.on("error", (e: unknown) => {
      setStatus("error");
      setError(e instanceof Error ? e.message : "The call couldn't connect. Check your microphone permission and try again.");
    });
    v.on("message", (m: { type?: string; transcriptType?: string; role?: string; transcript?: string }) => {
      if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) {
        setLines((prev) => [...prev, { role: m.role === "user" ? "You" : agentName, text: m.transcript! }]);
      }
    });
    vapi.current = v;
    return () => {
      v.stop();
    };
  }, [publicKey, agentName]);

  if (!publicKey) return <p style={{ color: "#8a4b00" }}>Browser calls aren&apos;t configured yet (missing Vapi public key).</p>;

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
    <section>
      <button
        onClick={live ? () => vapi.current?.stop() : start}
        style={{
          padding: "12px 20px", fontSize: 16, borderRadius: 999, border: "none", cursor: "pointer",
          background: live ? "#b42318" : "#0b6e4f", color: "white",
        }}
      >
        {status === "connecting" ? "Connecting…" : live ? "End call" : `Talk to ${agentName}`}
      </button>
      <span style={{ marginLeft: 12, color: "#555" }}>
        {status === "live" && "Live: speak normally. Allow microphone access if asked."}
        {status === "ended" && "Call ended."}
      </span>
      {error && <p style={{ color: "#b42318" }}>{error}</p>}
      {lines.length > 0 && (
        <ol style={{ listStyle: "none", padding: 0, marginTop: 16, maxHeight: 320, overflowY: "auto" }}>
          {lines.map((l, i) => (
            <li key={i} style={{ margin: "6px 0" }}>
              <strong>{l.role}:</strong> {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
