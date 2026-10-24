// Applies supabase/schema.sql to the Supabase database. Idempotent; safe to rerun.
// Usage: npm run db:apply   (needs SUPABASE_DB_URL in .env)

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { REPO_ROOT } from "../lib/config";

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set. Add the Session pooler URI to .env (see docs/account-setup.md).");

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
