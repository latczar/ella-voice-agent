// Unit tests for business-hours routing. Run: npm run test:unit
// Times are given in UTC; America/Chicago is UTC-5 (CDT) on these dates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../lib/config";
import { checkHours } from "../../lib/hours";

const c = loadConfig("jrco");
const at = (dept: string, iso: string) => checkHours(c.departments[dept].hours, c.locale.timezone, new Date(iso));

test("weekday morning: Residential Sales is open", () => {
  assert.deepEqual(at("residential_sales", "2026-10-26T14:00:00Z").open, true);
});

test("weekday evening: closed, reopens tomorrow at 7 AM", () => {
  const r = at("residential_sales", "2026-10-26T23:30:00Z");
  assert.equal(r.open, false);
  assert.equal(r.nextOpen, "tomorrow at 7 AM");
});

test("Saturday afternoon: closed until Monday", () => {
  assert.equal(at("residential_sales", "2026-10-24T19:00:00Z").nextOpen, "Monday at 7 AM");
});

test("Saturday before opening: reopens today", () => {
  assert.equal(at("residential_sales", "2026-10-24T12:00:00Z").nextOpen, "today at 8 AM");
});

test("Finance keeps office hours: closed on Saturday morning", () => {
  const r = at("finance", "2026-10-24T15:00:00Z");
  assert.equal(r.open, false);
  assert.equal(r.nextOpen, "Monday at 8 AM");
});

test("On-call is open at 3 AM on a Sunday", () => {
  const r = at("on_call", "2026-10-25T08:00:00Z");
  assert.equal(r.open, true);
  assert.equal(r.nextOpen, null);
});

test("closing time is exclusive: 6:00 PM counts as closed", () => {
  assert.equal(at("residential_sales", "2026-10-26T23:00:00Z").open, false);
});
