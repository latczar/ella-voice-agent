// Server events from Vapi (assistant server URL). We act on the end-of-call report:
// the call is stored straight away, and the HubSpot write-up runs after the response.
// Retried reports are recognised by call ID and ignored.

import { after, NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/server/auth";
import { callContext, configFromUrl } from "@/lib/server/context";
import { logError } from "@/lib/server/db";
import { storeCall, syncToCrm } from "@/lib/server/end-of-call";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!hasValidSecret(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let message: Record<string, unknown>;
  try {
    message = ((await req.json()) as { message?: Record<string, unknown> }).message ?? {};
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (message.type !== "end-of-call-report") {
    // status-update and hang are subscribed for visibility in Vercel logs only.
    if (message.type === "hang") await logError("vapi:hang", "Vapi reported a delay of 5+ seconds on a call", (message.call as { id?: string })?.id);
    return NextResponse.json({ ok: true });
  }

  try {
    const ctx = callContext(configFromUrl(req.url), message);
    const { fresh, summary, lead } = await storeCall(message, ctx);
    if (!fresh) return NextResponse.json({ ok: true, duplicate: true });
    after(() => syncToCrm(message, ctx, summary, lead));
    return NextResponse.json({ ok: true, outcome: summary.outcome });
  } catch (err) {
    await logError("webhook:end-of-call", (err as Error).message, (message.call as { id?: string })?.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
