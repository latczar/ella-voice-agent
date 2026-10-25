// Free checks on the persona files: everything that can be checked without talking to Vapi.
// Used by the unit tests (tests/unit/personas.test.ts) and the dashboard's free sanity checks,
// so a typo, a pattern that can never match, or a scenario timed when its department is
// closed is caught before anyone pays for a run.

import type { ClientConfig } from "./config";
import { checkHours } from "./hours";
import type { PatternExamples, Persona } from "./persona-runner";
import { toolSpecs, transferToolName } from "./tools";

/** Every problem found in one persona file; empty when it's sound. */
export function lintPersona(p: Persona, c: ClientConfig): string[] {
  const problems: string[] = [];
  const specs = toolSpecs(c);
  const knownTools = new Set([...specs.map((t) => t.name), ...Object.keys(c.departments).map(transferToolName)]);
  const leadFields = new Set(Object.keys(specs.find((t) => t.name === "log_lead")?.parameters.properties ?? {}));

  if (!p.name || !p.opening || !p.caller || !p.expect) return ["name, opening, caller and expect must all be set"];
  if (p.time && (Number.isNaN(Date.parse(p.time)) || !p.time.endsWith("Z"))) problems.push(`time "${p.time}" isn't an ISO time in UTC (ending in Z)`);

  const e = p.expect;
  for (const t of [...(e.tools ?? []), ...(e.tools_any ?? []), ...(e.tools_not ?? [])]) {
    if (!knownTools.has(t)) problems.push(`unknown tool "${t}"`);
  }
  if (e.intent && !c.intents.some((i) => i.id === e.intent)) problems.push(`unknown intent "${e.intent}"`);
  for (const f of [...(e.lead_fields ?? []), ...Object.keys(e.lead_matches ?? {})]) {
    if (!leadFields.has(f)) problems.push(`unknown lead field "${f}"`);
  }

  // A scenario expecting a transfer must run when that department is open, or Ella is right not to transfer.
  for (const t of (e.tools ?? []).filter((x) => x.startsWith("transfer_to_"))) {
    const dept = c.departments[t.replace("transfer_to_", "")];
    if (!dept) continue; // already reported as an unknown tool
    if (!p.time) problems.push(`expects ${t} but sets no time, so the result depends on when it runs`);
    else if (!checkHours(dept.hours, c.locale.timezone, new Date(p.time)).open) problems.push(`expects ${t}, but ${dept.name} is closed at ${p.time}`);
  }

  // Every pattern compiles and matches its own examples.
  const patterns = [
    ...(e.says ?? []).map((s) => ({ label: s.check, ...s })),
    ...(e.never_says ?? []).map((s) => ({ label: s.check, ...s })),
    ...(e.max_asks ?? []).map((s) => ({ label: `asks for ${s.about}`, ...s })),
    ...Object.entries(e.lead_matches ?? {}).map(([field, pattern]) => ({ label: field, pattern, examples: undefined as PatternExamples | undefined })),
  ];
  for (const { label, pattern, examples } of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "i");
    } catch (err) {
      problems.push(`"${label}": pattern doesn't compile (${(err as Error).message})`);
      continue;
    }
    for (const line of examples?.match ?? []) if (!re.test(line)) problems.push(`"${label}": should match "${line}"`);
    for (const line of examples?.no_match ?? []) if (re.test(line)) problems.push(`"${label}": shouldn't match "${line}"`);
  }

  // Synthetic data only: 555-01xx numbers and example.com emails.
  for (const phone of p.caller.match(/\b\d{3}-\d{3}-\d{4}\b/g) ?? []) {
    if (!/^\d{3}-555-01\d\d$/.test(phone)) problems.push(`phone ${phone} isn't a synthetic 555-01xx number`);
  }
  for (const email of p.caller.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
    if (!/@example\.com$/.test(email)) problems.push(`email ${email} isn't an example.com address`);
  }
  return problems;
}
