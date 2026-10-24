// The dashboard's "Run tests" endpoint spends Vapi credit, so it must refuse anything without
// the admin passcode. These checks never send a valid passcode, so they cost nothing.
// Target: TEST_BASE_URL, else PUBLIC_BASE_URL (the deployed app).

import "dotenv/config";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.TEST_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

async function post(body: unknown): Promise<{ status: number; json: { ok?: boolean; error?: string } }> {
  const res = await fetch(`${BASE}/api/tests/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

describe(`run-tests endpoint at ${BASE}`, () => {
  // 503 when the passcode isn't configured on that server (the feature is off), 401 otherwise.
  test("refuses a start without a passcode", async () => {
    const { status, json } = await post({ action: "start" });
    assert.ok(status === 401 || status === 503, `expected 401 or 503, got ${status}`);
    assert.equal(json.ok, false);
    assert.ok(json.error && json.error.length > 10, "a readable error message");
  });

  test("refuses a wrong passcode", async () => {
    const { status } = await post({ action: "start", passcode: `wrong-${Date.now()}` });
    assert.ok(status === 401 || status === 503, `expected 401 or 503, got ${status}`);
  });

  test("refuses to run a persona without a passcode", async () => {
    const { status } = await post({ action: "persona", runId: "00000000-0000-0000-0000-000000000000", file: "01-residential-in-hours.yaml" });
    assert.ok(status === 401 || status === 503, `expected 401 or 503, got ${status}`);
  });

  test("rejects a body that isn't JSON", async () => {
    const res = await fetch(`${BASE}/api/tests/run`, { method: "POST", body: "not json" });
    assert.equal(res.status, 400);
  });
});
