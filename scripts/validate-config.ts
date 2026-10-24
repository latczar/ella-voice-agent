// Validates a client config: JSON Schema, cross-checks, KB, and that the prompts render.
// Usage: npm run validate -- [client_id]   (defaults to CLIENT_ID from .env, then "jrco")
// Exit code 0 = valid, 1 = problems (listed).

import "dotenv/config";
import { ConfigError, loadConfig, transferTargets } from "../lib/config";
import { loadKbFiles } from "../lib/kb";
import { renderDepartmentPrompt, renderSystemPrompt } from "../lib/prompt";

const clientId = process.argv[2] ?? process.env.CLIENT_ID ?? "jrco";

function main(): number {
  console.log(`Validating configs/${clientId}.yaml`);

  let config;
  try {
    config = loadConfig(clientId);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : `Unexpected error: ${(err as Error).message}`);
    return 1;
  }
  console.log("  ok  schema and cross-checks");

  const problems: string[] = [];

  try {
    const files = loadKbFiles(config);
    console.log(`  ok  knowledge base: ${files.length} files in ${config.kb.path}`);
  } catch (err) {
    problems.push((err as Error).message);
  }

  try {
    const prompt = renderSystemPrompt(config);
    console.log(`  ok  system prompt renders (${prompt.length} chars, about ${Math.round(prompt.length / 4)} tokens)`);
    for (const key of Object.keys(config.departments)) renderDepartmentPrompt(config, key);
    console.log(`  ok  ${Object.keys(config.departments).length} department prompts render`);
  } catch (err) {
    problems.push(`prompt rendering failed: ${(err as Error).message}`);
  }

  // Number reachability: an "auto" number doesn't exist until provisioning claims it.
  const ella = config.agent.phone.number;
  console.log(ella === "auto" ? `  --  ${config.agent.name}'s number: "auto" (claimed by provisioning)` : `  ok  ${config.agent.name}'s number: ${ella}`);
  for (const t of transferTargets(config)) {
    console.log(t.via === "handoff" ? `  ok  ${t.key}: in-call hand-off to a stand-in assistant` : `  ok  ${t.key}: phone transfer to ${t.number}`);
  }

  if (config.kb.mode === "vapi") problems.push('kb.mode "vapi" is not implemented in this build; use "prompt" (see scripts/load-kb.ts).');

  if (config.alerts.sms_mode === "live") {
    problems.push('alerts.sms_mode "live" needs a registered (A2P 10DLC) Twilio sender, which this build does not have. Use "test" or "push".');
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
    return 1;
  }
  console.log("\nConfig is valid.");
  return 0;
}

process.exit(main());
