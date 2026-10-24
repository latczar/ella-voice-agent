// Push notifications via ntfy (https://ntfy.sh). Anyone subscribed to the topic gets them,
// so the topic name is long and random, and kept in .env.

export interface PushMessage {
  title: string;
  message: string;
  priority?: "min" | "low" | "default" | "high" | "urgent";
  tags?: string[];
}

export async function sendPush(topic: string, push: PushMessage): Promise<{ ok: boolean; error?: string }> {
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  if (!topic) return { ok: false, error: "ntfy topic is not set" };
  try {
    const res = await fetch(server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // JSON publishing keeps non-ASCII titles intact (headers can't carry them).
      body: JSON.stringify({ topic, title: push.title, message: push.message, priority: priorityNumber(push.priority), tags: push.tags ?? [] }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `ntfy returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: `ntfy request failed: ${(err as Error).message}` };
  }
}

function priorityNumber(p: PushMessage["priority"]): number {
  return { min: 1, low: 2, default: 3, high: 4, urgent: 5 }[p ?? "default"];
}
