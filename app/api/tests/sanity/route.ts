// Free sanity checks for the Tests page (lib/server/sanity-checks.ts). Spends no Vapi credit and
// writes nothing, so it needs no passcode: anyone viewing the dashboard can run it.

import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runSanityChecks } from "@/lib/server/sanity-checks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const started = Date.now();
  const checks = await runSanityChecks({
    clientId: process.env.CLIENT_ID ?? "jrco",
    baseUrl: new URL(req.url).origin,
    vapiKey: process.env.VAPI_PRIVATE_KEY,
    db: db(),
  });
  const failed = checks.filter((c) => !c.passed).length;
  return NextResponse.json(
    { ok: true, passed: checks.length - failed, failed, ms: Date.now() - started, checks },
    { headers: { "cache-control": "no-store" } },
  );
}
