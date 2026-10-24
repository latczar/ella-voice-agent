"use client";

// "Talk to Ella": a browser call through the Vapi Web SDK, with a live transcript.
// Uses the public key only. Hand-offs to the department assistants work here too.

import Vapi from "@vapi-ai/web";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CALLS_CHANGED } from "./live-refresh";

type Status = "idle" | "connecting" | "live" | "ended" | "error";
interface Line {
  agent: boolean;
  text: string;
}
interface TranscriptMessage { type?: string; transcriptType?: string; role?: string; transcript?: string }

export default function TalkToElla({ assistantId, agentName }: { assistantId: string; agentName: string }) {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const vapi = useRef<Vapi | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  // The words being spoken right now, before the transcriber settles on them.
  const [interim, setInterim] = useState<Line | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!publicKey) return;
    const v = new Vapi(publicKey);
    v.on("call-start", () => setStatus("live"));
    v.on("call-end", () => {
      setStatus("ended");
      setSpeaking(false);
      setInterim(null);
      setMuted(false);
      // The end-of-call report reaches the webhook a few seconds after hang-up; refresh the call list then.
      for (const ms of [4000, 12000, 25000]) setTimeout(() => window.dispatchEvent(new Event(CALLS_CHANGED)), ms);
    });
    v.on("speech-start", () => setSpeaking(true));
    v.on("speech-end", () => setSpeaking(false));
    v.on("error", (e: unknown) => {
      setStatus("error");
      setError(e instanceof Error ? e.message : "The call couldn't connect. Check microphone access and try again.");
    });
    v.on("message", (m: TranscriptMessage) => {
      if (m.type !== "transcript" || !m.transcript) return;
      const line = { agent: m.role !== "user", text: m.transcript };
      if (m.transcriptType === "final") {
        setLines((prev) => [...prev, line]);
        setInterim(null);
      } else {
        setInterim(line);
      }
    });
    vapi.current = v;
    return () => { v.stop(); };
  }, [publicKey]);

  // Scroll the transcript box only (never the page) as new lines arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, interim]);

  if (!publicKey) return <div className="notice warn">Browser calls aren&apos;t configured on this deployment (missing Vapi public key).</div>;

  const start = async () => {
    setError(null);
    setLines([]);
    setInterim(null);
    setStatus("connecting");
    try {
      await vapi.current?.start(assistantId);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  };
  const toggleMute = () => {
    const next = !muted;
    vapi.current?.setMuted(next);
    setMuted(next);
  };
  const clear = () => {
    setLines([]);
    setInterim(null);
    setError(null);
    if (status === "ended" || status === "error") setStatus("idle");
  };
  const live = status === "connecting" || status === "live";
  const shown = interim ? [...lines, interim] : lines;

  return (
    <div className="call-panel">
      <div className="call-toolbar">
        <button className={`btn ${live ? "btn-danger" : "btn-primary"}`} onClick={live ? () => vapi.current?.stop() : start} disabled={status === "connecting"}>
          {status === "connecting" ? "Connecting…" : live ? "End call" : status === "ended" ? "Call again" : "Start browser call"}
        </button>
        {status === "live" && (
          <>
            <button className="btn btn-sm" onClick={toggleMute} aria-pressed={muted}>{muted ? "Unmute" : "Mute"}</button>
            <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="live-dot" /> {muted ? "Muted" : speaking ? `${agentName} is speaking` : "Listening"}
            </span>
          </>
        )}
        {status === "ended" && (
          <span className="muted">
            Call ended. It appears in <Link className="link" href="/calls">Calls</Link> within a few seconds.
          </span>
        )}
        {shown.length > 0 && !live && (
          <button className="btn btn-sm spacer" onClick={clear}>Clear transcript</button>
        )}
      </div>
      {error && <div className="notice warn">{error}</div>}
      {shown.length > 0 && (
        <div className="card" style={{ boxShadow: "none" }}>
          <div ref={scrollRef} className="card-body transcript" style={{ maxHeight: 280, overflowY: "auto" }}>
            {shown.map((l, i) => (
              <div key={i} className={`turn${l.agent ? " agent" : ""}${l === interim ? " interim" : ""}`}>
                <div className="turn-role">{l.agent ? agentName : "You"}</div>
                <div>{l.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
