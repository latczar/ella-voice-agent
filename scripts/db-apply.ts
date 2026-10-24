// Applies supabase/schema.sql to the Supabase database. Idempotent; safe to rerun.
// Usage: npm run db:apply   (needs SUPABASE_DB_URL and SUPABASE_DB_PASSWORD in .env)

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { REPO_ROOT } from "../lib/config";

/** The pooler URI with the password filled in and percent-encoded, so symbols like @ are safe. */
function connectionString(): string {
  const url = process.env.SUPABASE_DB_URL?.trim();
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!url || !url.startsWith("postgres")) {
    throw new Error("SUPABASE_DB_URL must be the Session pooler URI (postgresql://...). See docs/account-setup.md.");
  }
  if (url.includes("[YOUR-PASSWORD]")) {
    if (!password) throw new Error("SUPABASE_DB_PASSWORD is not set (the URI still has [YOUR-PASSWORD] in it).");
    return url.replace("[YOUR-PASSWORD]", encodeURIComponent(password));
  }
  return url;
}

async function main(): Promise<void> {
  const url = connectionString();

  const sql = readFileSync(path.join(REPO_ROOT, "supabase", "schema.sql"), "utf8");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    console.log(`Schema applied. Public tables and views: ${rows.map((r) => r.table_name).join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`db:apply failed: ${(err as Error).message}`);
  process.exit(1);
});
