// Free checks on the persona files and the harness's assertions, so a typo or a pattern that can
// never match is caught before a paid run. Run: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../lib/config";
import { lintPersona } from "../../lib/persona-lint";
import { checkConversation, loadPersonas, type Conversation, type Persona } from "../../lib/persona-runner";

const c = loadConfig("jrco");
const personas = loadPersonas();
const conv = (ellaTurns: string[], extra: Partial<Conversation> = {}): Conversation => ({ ellaTurns, toolsCalled: [], okActions: new Set(), ...extra });
const failed = (checks: { name: string; passed: boolean }[]) => checks.filter((x) => !x.passed).map((x) => x.name);

// ---- The persona files ---------------------------------------------------------

test("persona files are numbered 01 to 14 with no gaps", () => {
  assert.deepEqual(personas.map((p) => p.file.slice(0, 2)), Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, "0")));
});

for (const p of personas) {
  test(`${p.file}: real tools, intents and fields; synthetic details; transfers open at its time; patterns match their examples`, () => {
    assert.deepEqual(lintPersona(p, c), []);
  });
}

test("the linter catches broken persona files", () => {
  const base: Persona = { file: "x.yaml", name: "x", opening: "hi", caller: "You are X.", expect: {} };
  const problems = (overrides: Partial<Persona>) => lintPersona({ ...base, ...overrides }, c);
  assert.match(problems({ expect: { tools: ["transfer_to_nowhere"] } }).join(), /unknown tool/);
  assert.match(problems({ expect: { intent: "nonsense" } }).join(), /unknown intent/);
  assert.match(problems({ expect: { lead_fields: ["shoe_size"] } }).join(), /unknown lead field/);
  assert.match(problems({ time: "2026-10-28T04:00:00Z", expect: { tools: ["transfer_to_finance"] } }).join(), /Finance is closed/);
  assert.match(problems({ expect: { tools: ["transfer_to_finance"] } }).join(), /sets no time/);
  assert.match(problems({ expect: { says: [{ check: "x", pattern: "(" }] } }).join(), /doesn't compile/);
  assert.match(problems({ expect: { says: [{ check: "x", pattern: "hello", examples: { match: ["goodbye"] } }] } }).join(), /should match/);
  assert.match(problems({ caller: "Phone 312-867-5309, email me@gmail.com." }).join(), /isn't a synthetic.*isn't an example\.com/);
});

// ---- The assertion types -------------------------------------------------------

test("says and never_says: pass and fail on Ella's turns only", () => {
  const e = { says: [{ check: "Says hello", pattern: "hello" }], never_says: [{ check: "No secret", pattern: "secret" }] };
  assert.deepEqual(failed(checkConversation(e, conv(["Hello there."]))), []);
  assert.deepEqual(failed(checkConversation(e, conv(["Here's the secret."]))), ["Says hello", "No secret"]);
});

test("lead_matches: checks the saved value, and fails when the field is missing", () => {
  const e = { lead_matches: { invoice_or_account_number: "20417" } };
  assert.deepEqual(failed(checkConversation(e, conv([], { lead: { invoice_or_account_number: "INV-20417" } }))), []);
  assert.equal(checkConversation(e, conv([], { lead: {} }))[0].passed, false);
  assert.equal(checkConversation(e, conv([]))[0].detail, "missing");
});

test("max_asks: counts the turns that ask", () => {
  const e = { max_asks: [{ about: "their name", pattern: "\\bname\\b[^.!]*\\?", max: 2 }] };
  const asks = ["Can I get your name?", "No problem. Could I just take a first name, so the team knows who to ask for?"];
  assert.deepEqual(failed(checkConversation(e, conv([...asks, "That's fine. Your name isn't needed for this."]))), []);
  assert.equal(checkConversation(e, conv([...asks, "Sorry, what was your name?"]))[0].passed, false);
});

test("always checked: no prices, and short turns", () => {
  assert.deepEqual(failed(checkConversation({}, conv(["A new roof is about $9,000."]))), ["No price figures"]);
  const long = "Thanks so much for calling us today, I really appreciate it, and I would love to help you get this sorted out as soon as we possibly can.";
  assert.deepEqual(failed(checkConversation({}, conv([long]))), ["Every turn under 25 words and at most 3 sentences"]);
});
