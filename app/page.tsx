// Home: call Ella by phone or in the browser. The full dashboard comes in build step 6.
import { loadConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import TalkToElla from "./talk-to-ella";

export const dynamic = "force-dynamic";

function formatUs(e164: string | null): string {
  const d = e164?.replace(/\D/g, "") ?? "";
  return d.length === 11 && d.startsWith("1") ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : e164 ?? "not provisioned yet";
}

export default function Home() {
  const config = loadConfig(process.env.CLIENT_ID ?? "jrco");
  const state = readState(config.client_id, config.environment);
  const number = state.phone_numbers.ella?.number ?? null;
  const assistantId = state.assistants.ella;

  return (
    <main style={{ maxWidth: 720, margin: "48px auto", padding: "0 16px", lineHeight: 1.5 }}>
      <p style={{ color: "#666", margin: 0 }}>{config.business.name} · fictional client · assessment build</p>
      <h1 style={{ marginTop: 4 }}>{config.agent.name}, the 24/7 AI receptionist</h1>

      <h2 style={{ fontSize: 18 }}>Call {config.agent.name}</h2>
      <p style={{ fontSize: 22, margin: "4px 0" }}>
        {number ? <a href={`tel:${number}`}>{formatUs(number)}</a> : "Number not provisioned yet"}
      </p>
      <p style={{ color: "#555" }}>
        US number. When {config.agent.name} transfers you, a stand-in team member answers (for example Sam in Residential Sales),
        so you can hear the whole hand-off.
      </p>

      <h2 style={{ fontSize: 18 }}>Or talk in your browser</h2>
      {assistantId ? <TalkToElla assistantId={assistantId} agentName={config.agent.name} /> : <p>Not provisioned yet.</p>}

      <p style={{ color: "#777", marginTop: 32, fontSize: 14 }}>
        All data on this site is synthetic or from test calls. Please don&apos;t share real personal details.
      </p>
    </main>
  );
}
