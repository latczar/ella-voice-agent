// In-call tool webhook. Vapi POSTs a "tool-calls" message while the caller waits;
// we answer every call in the batch with a result or an error (always HTTP 200,
// as Vapi expects), so a failure is spoken as the tool's fallback line.

import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/server/auth";
import { callContext, configFromUrl } from "@/lib/server/context";
import { logError } from "@/lib/server/db";
import { runTool } from "@/lib/server/tool-handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ToolCall {
  id: string;
  function?: { name?: string; arguments?: unknown };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export async function POST(req: Request) {
  if (!hasValidSecret(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { message?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const message = body.message ?? {};
  const calls = (message.toolCallList as ToolCall[] | undefined) ?? [];
  if (message.type !== "tool-calls" || calls.length === 0) {
    return NextResponse.json({ error: 'Expected a "tool-calls" message with a toolCallList' }, { status: 400 });
  }

  let ctx;
  try {
    ctx = callContext(configFromUrl(req.url), message);
  } catch (err) {
    await logError("webhook:tools", `Bad client config: ${(err as Error).message}`);
    return NextResponse.json({
      results: calls.map((c) => ({ toolCallId: c.id, name: c.function?.name ?? "unknown", error: "Configuration problem on our side." })),
    });
  }

  const results = await Promise.all(
    calls.map(async (call) => {
      const name = call.function?.name ?? "unknown";
      const outcome = await runTool(name, parseArgs(call.function?.arguments), ctx);
      return { toolCallId: call.id, name, ...outcome };
    }),
  );
  return NextResponse.json({ results });
}
