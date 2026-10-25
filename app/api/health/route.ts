// Health check for uptime monitoring (BetterStack polls it every few minutes).
// Reports which integrations are configured, never their values, and checks the
// database answers. Returns 503 if it doesn't, so the monitor marks Ella as down.
// Costs nothing: no Vapi, HubSpot or Cal.com calls. The regular database read also
// stops the free Supabase project pausing for inactivity.
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3000;

async function databaseReachable(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  const client = db();
  if (!client) return { ok: false, ms: 0, error: "not configured" };
  try {
    const { error } = await client
      .from("calls")
      .select("id", { head: true, count: "estimated" })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    const ms = Date.now() - started;
    return error ? { ok: false, ms, error: "query failed" } : { ok: true, ms };
  } catch {
    return { ok: false, ms: Date.now() - started, error: "unreachable or timed out" };
  }
}

export async function GET() {
  const configured = (name: string) => Boolean(process.env[name]);
  const database = await databaseReachable();
  return NextResponse.json(
    {
      ok: database.ok,
      time: new Date().toISOString(),
      checks: { database },
      integrations: {
        vapi_webhook_secret: configured("VAPI_WEBHOOK_SECRET"),
        supabase: configured("NEXT_PUBLIC_SUPABASE_URL") && configured("SUPABASE_SERVICE_ROLE_KEY"),
        hubspot: configured("HUBSPOT_PRIVATE_APP_TOKEN"),
        calcom: configured("CALCOM_API_KEY") && configured("CALCOM_EVENT_TYPE_ID"),
        twilio_test: configured("TWILIO_TEST_ACCOUNT_SID") && configured("TWILIO_TEST_AUTH_TOKEN"),
        ntfy: configured("NTFY_TOPIC"),
      },
    },
    { status: database.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
