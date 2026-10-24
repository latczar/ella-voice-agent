// Writes the rendered prompts to build/prompts/<client>/ so they can be read and reviewed
// before provisioning. Usage: npm run render -- [client_id]

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, REPO_ROOT } from "../lib/config";
import { departmentFirstMessage, renderDepartmentPrompt, renderSystemPrompt } from "../lib/prompt";

const clientId = process.argv[2] ?? process.env.CLIENT_ID ?? "jrco";
const config = loadConfig(clientId);
const outDir = path.join(REPO_ROOT, "build", "prompts", clientId);
mkdirSync(outDir, { recursive: true });

const ella = `First message: ${config.agent.first_message}\n\n---\n\n${renderSystemPrompt(config)}`;
writeFileSync(path.join(outDir, "system.md"), ella);
for (const key of Object.keys(config.departments)) {
  const text = `First message: ${departmentFirstMessage(config, key)}\n\n---\n\n${renderDepartmentPrompt(config, key)}`;
  writeFileSync(path.join(outDir, `department-${key}.md`), text);
}
console.log(`Rendered ${1 + Object.keys(config.departments).length} prompts to ${path.relative(REPO_ROOT, outDir)}`);
