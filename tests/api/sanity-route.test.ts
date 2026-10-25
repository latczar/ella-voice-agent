// The Tests page's free sanity checks: they must run without a passcode, spend nothing, and all
// pass on a healthy deployment. Target: TEST_BASE_URL, else PUBLIC_BASE_URL (the deployed app).

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.TEST_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

test(`sanity checks at ${BASE} run without a passcode and all pass`, async (t) => {
  const res = await fetch(`${BASE}/api/tests/sanity`, { method: "POST" });
  if (res.status === 404) return t.skip("not deployed there yet");
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; checks: { group: string; name: string; passed: boolean; detail?: string }[] };
  assert.equal(json.ok, true);
  assert.ok(json.checks.length > 10, "a full set of checks");
  const failures = json.checks.filter((c) => !c.passed).map((c) => `[${c.group}] ${c.name}: ${c.detail ?? ""}`);
  assert.deepEqual(failures, []);
});
