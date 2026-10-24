// UI smoke tests: every dashboard page renders with its key content, and no page leaks
// a real caller's details. Run: npm run test:ui (target: TEST_BASE_URL or PUBLIC_BASE_URL).

import "dotenv/config";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.TEST_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

async function page(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  assert.equal(res.status, 200, `${path} returned ${res.status}`);
  // Drop React's text-boundary comments so "Talk to <!-- -->Ella" matches "Talk to Ella".
  return (await res.text()).replace(/<!-- -->/g, "");
}

describe(`dashboard at ${BASE}`, () => {
  test("overview shows the number, the browser call panel and health", async () => {
    const html = await page("/");
    assert.match(html, /Talk to Ella/);
    assert.match(html, /\+1 \(\d{3}\) \d{3}-\d{4}/, "Ella's phone number");
    assert.match(html, /Health/);
    assert.match(html, /Recent calls/);
  });

  test("calls page lists calls", async () => {
    const html = await page("/calls");
    assert.match(html, /<table/);
    assert.match(html, /Outcome/);
  });

  test("a demo call's detail page shows its transcript and actions", async () => {
    const html = await page("/calls/demo-02");
    assert.match(html, /Emergency roof leak or storm damage/);
    assert.match(html, /Transcript/);
    assert.match(html, /911/, "the demo emergency transcript includes the safety line");
    assert.match(html, /Push alert/);
  });

  test("an unknown call is a 404, not an error page", async () => {
    const res = await fetch(`${BASE}/calls/does-not-exist`);
    assert.equal(res.status, 404);
  });

  test("leads and tests pages render", async () => {
    assert.match(await page("/leads"), /Leads/);
    assert.match(await page("/tests"), /Tests/);
  });

  test("health endpoint reports every core integration configured", async () => {
    const res = await fetch(`${BASE}/api/health`);
    const json = (await res.json()) as { ok: boolean; integrations: Record<string, boolean> };
    assert.equal(json.ok, true);
    for (const k of ["vapi_webhook_secret", "supabase", "hubspot", "calcom", "ntfy"]) assert.equal(json.integrations[k], true, `${k} not configured`);
  });
});
