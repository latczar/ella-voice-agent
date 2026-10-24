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

  // Number reachability: "auto" numbers don't exist until provisioning creates them.
  // After provisioning, scripts/provision.ts checks each number is attached in Vapi.
  for (const t of transferTargets(config)) {
    if (t.number === "auto") console.log(`  --  ${t.key}: number is "auto" (created by provisioning)`);
    else console.log(`  ok  ${t.key}: ${t.number}`);
  }

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
