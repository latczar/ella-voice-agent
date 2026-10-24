// API tests for the Vapi webhooks, with fake Vapi payloads. Run: npm run test:api
// Target: TEST_BASE_URL, else PUBLIC_BASE_URL (the deployed app). Rows are flagged as
// test rows and deleted afterwards. Side effects are kept off by default:
//   - send_emergency_alert pushes to the on-call phone; set TEST_ALERTS=1 to include it.
//   - book_appointment would create a real Cal.com booking; only its error path is tested.

import "dotenv/config";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.TEST_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const SECRET = process.env.VAPI_WEBHOOK_SECRET ?? "";
const SCOPE = "client=jrco&env=staging";
const RUN = `apitest-${Date.now()}`;
const createdCallIds = new Set<string>();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const service = supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;

interface ToolResult { toolCallId: string; name: string; result?: string; error?: string }

function call(id: string, vars: Record<string, string> = {}) {
  createdCallIds.add(id);
  return { id, type: "webCall", assistantOverrides: { variableValues: { is_test: "true", ...vars } } };
}

async function post(route: "tools" | "events", body: unknown, secret: string | null = SECRET): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/vapi/${route}?${SCOPE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "x-vapi-secret": secret }) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function tools(callId: string, calls: { name: string; args: unknown }[], vars: Record<string, string> = {}): Promise<ToolResult[]> {
  const { status, json } = await post("tools", {
    message: { type: "tool-calls", call: call(callId, vars), toolCallList: calls.map((c, i) => ({ id: `t${i}`, function: { name: c.name, arguments: c.args } })) },
  });
  assert.equal(status, 200);
  return json.results as ToolResult[];
}

const parsed = (r: ToolResult) => JSON.parse(r.result ?? "{}") as Record<string, unknown>;

describe(`webhooks at ${BASE}`, () => {
  describe("security", () => {
    test("rejects a request with no secret", async () => {
      assert.equal((await post("tools", { message: { type: "tool-calls" } }, null)).status, 401);
      assert.equal((await post("events", { message: { type: "end-of-call-report" } }, null)).status, 401);
    });
    test("rejects a wrong secret", async () => {
      assert.equal((await post("tools", { message: { type: "tool-calls" } }, "not-the-secret")).status, 401);
    });
    test("rejects a tool request that isn't a tool-calls message", async () => {
      assert.equal((await post("tools", { message: { type: "status-update" } })).status, 400);
    });
  });

  describe("check_hours", () => {
    test("on-call can always take a transfer", async () => {
      const [r] = await tools(`${RUN}-hours`, [{ name: "check_hours", args: { department: "on_call" } }]);
      assert.equal(parsed(r).can_transfer, true);
    });
    test("a simulated unanswered team can't take a transfer, with a call-back instruction", async () => {
      const [r] = await tools(`${RUN}-unanswered`, [{ name: "check_hours", args: { department: "on_call" } }], { simulate_unanswered: "on_call" });
      assert.equal(parsed(r).can_transfer, false);
      assert.match(String(parsed(r).note), /call-back/i);
    });
    test("arguments sent as a JSON string are accepted", async () => {
      const [r] = await tools(`${RUN}-hours`, [{ name: "check_hours", args: JSON.stringify({ department: "finance" }) }]);
      assert.equal(typeof parsed(r).open, "boolean");
    });
    test("an unknown department returns an error that lists the valid ones", async () => {
      const [r] = await tools(`${RUN}-hours`, [{ name: "check_hours", args: { department: "sales" } }]);
      assert.match(r.error ?? "", /residential_sales/);
    });
  });

  describe("batches and unknown tools", () => {
    test("answers every call in a batch, matched by toolCallId", async () => {
      const results = await tools(`${RUN}-batch`, [
        { name: "check_hours", args: { department: "commercial" } },
        { name: "get_price", args: {} },
        { name: "check_hours", args: { department: "operations" } },
      ]);
      assert.deepEqual(results.map((r) => r.toolCallId), ["t0", "t1", "t2"]);
      assert.match(results[1].error ?? "", /Unknown tool/);
    });
  });

  describe("log_lead", () => {
    test("saves the lead and reports the fields still missing for the route", async () => {
      const id = `${RUN}-lead`;
      const [r] = await tools(id, [{ name: "log_lead", args: { intent: "new_residential", caller_need: "New Roof", full_name: "Test Caller", summary: "API test" } }]);
      const out = parsed(r);
      assert.equal(out.saved, true);
      assert.deepEqual(out.missing_fields, ["phone", "property_address", "property_type"]);
      if (service) {
        const { data } = await service.from("leads").select("full_name, intent").eq("call_id", id).single();
        assert.equal(data?.full_name, "Test Caller");
        const { data: c } = await service.from("calls").select("is_test").eq("id", id).single();
        assert.equal(c?.is_test, true, "test calls must be flagged so the dashboard shows them as tests");
      }
    });
    test("later calls merge into the lead without wiping earlier fields", async () => {
      const id = `${RUN}-lead`;
      const [r] = await tools(id, [{ name: "log_lead", args: { intent: "new_residential", caller_need: "New Roof", phone: "(312) 555-0199", property_address: "1 Test St, Chicago, IL 60601", property_type: "residential", summary: "API test, more details" } }]);
      assert.deepEqual(parsed(r).missing_fields, []);
      if (service) {
        const { data } = await service.from("leads").select("full_name, phone").eq("call_id", id).single();
        assert.equal(data?.full_name, "Test Caller");
        assert.equal(data?.phone, "+13125550199", "phone numbers are normalised to E.164");
      }
    });
    test("an unknown intent is rejected", async () => {
      const [r] = await tools(`${RUN}-badlead`, [{ name: "log_lead", args: { intent: "pizza", caller_need: "Other", summary: "x" } }]);
      assert.match(r.error ?? "", /Unknown intent/);
    });
  });

  describe("calendar", () => {
    test("check_availability offers at most the configured number of slots, on different days", async () => {
      const [r] = await tools(`${RUN}-cal`, [{ name: "check_availability", args: {} }]);
      const out = parsed(r) as { available: boolean; slots?: { start_time: string; say: string }[] };
      if (!out.available) return; // an empty calendar is a valid answer
      assert.ok(out.slots && out.slots.length >= 1 && out.slots.length <= 3);
      const days = new Set(out.slots!.map((s) => s.say.split(" at ")[0]));
      assert.equal(days.size, out.slots!.length);
    });
    test("book_appointment refuses without the required details", async () => {
      const [r] = await tools(`${RUN}-cal`, [{ name: "book_appointment", args: { start_time: "2030-01-01T15:00:00Z" } }]);
      assert.match(r.error ?? "", /required/);
    });
  });

  describe("send_emergency_alert", { skip: process.env.TEST_ALERTS !== "1" && "set TEST_ALERTS=1 (sends a real push)" }, () => {
    test("needs an address", async () => {
      const [r] = await tools(`${RUN}-alert`, [{ name: "send_emergency_alert", args: { summary: "TEST", danger_reported: false } }]);
      assert.match(r.error ?? "", /property_address/);
    });
    test("sends the alert and records it", async () => {
      const [r] = await tools(`${RUN}-alert`, [{ name: "send_emergency_alert", args: { property_address: "1 Test St, Chicago, IL", summary: "TEST ALERT from the API tests, please ignore", danger_reported: false } }]);
      assert.equal(parsed(r).alert_sent, true);
    });
  });

  describe("end-of-call report", () => {
    const id = `${RUN}-eoc`;
    const report = {
      message: {
        type: "end-of-call-report",
        call: call(id),
        endedReason: "customer-ended-call",
        startedAt: new Date(Date.now() - 120_000).toISOString(),
        endedAt: new Date().toISOString(),
        cost: 0.12,
        artifact: { transcript: "AI: Thanks for calling.\nUser: New roof please.", messages: [{ role: "tool_calls", toolCalls: [{ function: { name: "transfer_to_residential_sales" } }] }] },
        analysis: { summary: "API test call." },
      },
    };
    test("stores the call with the outcome worked out from the hand-off", async () => {
      const { status, json } = await post("events", report);
      assert.equal(status, 200);
      assert.equal(json.outcome, "transferred");
      if (service) {
        const { data } = await service.from("calls").select("outcome, route, duration_s, is_test").eq("id", id).single();
        assert.equal(data?.route, "residential_sales");
        assert.equal(data?.is_test, true);
        assert.ok((data?.duration_s ?? 0) >= 119);
      }
    });
    test("a retried report is ignored", async () => {
      const { json } = await post("events", report);
      assert.equal(json.duplicate, true);
    });
    test("transfer tools named only in the system prompt don't count as a hand-off", async () => {
      const { json } = await post("events", {
        message: {
          ...report.message,
          call: call(`${id}-nohandoff`),
          artifact: { transcript: "AI: Booked.", messages: [{ role: "system", message: "Tools: transfer_to_finance, transfer_to_on_call" }] },
        },
      });
      assert.notEqual(json.outcome, "transferred");
    });
    test("other server messages are acknowledged", async () => {
      const { status } = await post("events", { message: { type: "status-update", status: "in-progress" } });
      assert.equal(status, 200);
    });
  });

  after(async () => {
    if (!service || !createdCallIds.size) return;
    await service.from("calls").delete().in("id", [...createdCallIds]); // leads and actions cascade
    await service.from("errors").delete().like("call_id", `${RUN}%`);
  });
});
