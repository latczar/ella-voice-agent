// Knowledge base loader: checks the client's KB files and shows what Ella will be given.
// Usage: npm run load-kb -- [client_id]
//
// kb.mode "prompt" (used for JR&CO): the KB is inlined into Ella's system prompt at
// provisioning time, so there is nothing to upload. About 1,500 words of KB is well within
// what GPT-4o handles per turn, and it avoids a retrieval round trip mid-call.
//
// kb.mode "vapi" (Vapi's query tool, backed by Gemini file search) is not implemented in
// this build. It would upload each file with POST /file and attach a "query" tool to Ella.
// Worth doing once a client's KB outgrows the prompt (lib/kb.ts caps inlining at 20,000 characters).

import "dotenv/config";
import { loadConfig } from "../lib/config";
import { kbAsPromptText, loadKbFiles } from "../lib/kb";

const clientId = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.CLIENT_ID ?? "jrco";
const config = loadConfig(clientId);

if (config.kb.mode === "vapi") {
  console.error('kb.mode "vapi" is not implemented in this build. Set kb.mode: prompt (see the comment at the top of this script).');
  process.exit(1);
}

const files = loadKbFiles(config);
for (const f of files) {
  const words = f.content.split(/\s+/).length;
  console.log(`  ${f.name.padEnd(36)} ${String(words).padStart(5)} words`);
}
const text = kbAsPromptText(config);
console.log(`\n${files.length} files, ${text.length} characters (about ${Math.round(text.length / 4)} tokens), inlined into the system prompt.`);
console.log("Run npm run provision to push the updated prompt to Vapi.");
