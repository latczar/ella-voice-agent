// Knowledge base loader: reads the client's markdown files in filename order.
// mode "prompt" inlines the text into the system prompt; mode "vapi" uploads the
// same files to Vapi (scripts/load-kb.ts). One source of truth either way.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ClientConfig } from "./config";
import { REPO_ROOT } from "./config";

export interface KbFile {
  name: string;
  content: string;
}

// Rough guard: past this, inlining starts to cost real latency and tokens on every turn.
const MAX_INLINE_CHARS = 20_000;

export function loadKbFiles(config: ClientConfig): KbFile[] {
  const dir = path.join(REPO_ROOT, config.kb.path);
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    throw new Error(`Knowledge base folder not found: ${dir} (kb.path in configs/${config.client_id}.yaml)`);
  }
  if (names.length === 0) throw new Error(`Knowledge base folder ${dir} has no .md files`);
  return names.map((name) => ({ name, content: readFileSync(path.join(dir, name), "utf8").trim() }));
}

/** All KB files joined, with headings demoted one level so they sit under "# Knowledge base". */
export function kbAsPromptText(config: ClientConfig): string {
  const text = loadKbFiles(config)
    .map((f) => f.content.replace(/^(#+) /gm, "#$1 "))
    .join("\n\n");
  if (text.length > MAX_INLINE_CHARS) {
    throw new Error(
      `Knowledge base is ${text.length} characters; inlining is capped at ${MAX_INLINE_CHARS}. Trim it or set kb.mode: vapi.`,
    );
  }
  return text;
}
