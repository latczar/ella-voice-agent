// Writes .env.vercel: the variables the deployed app needs, with values from .env and no
// comments, ready to paste into Vercel (Project > Settings > Environment Variables: paste
// the whole file into the first Key box). Rerun whenever .env changes.
// The file is gitignored. Values are never printed.
// Usage: npm run env:vercel

import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";

// What the Next.js app reads at runtime. VAPI_PRIVATE_KEY and DASHBOARD_ADMIN_PASSCODE are
// only needed for the Tests page's Run tests button. Script-only values (SUPABASE_DB_URL,
// SUPABASE_DB_PASSWORD) stay local.
const APP_VARS = [
  "VAPI_WEBHOOK_SECRET",
  "NEXT_PUBLIC_VAPI_PUBLIC_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HUBSPOT_PRIVATE_APP_TOKEN",
  "CALCOM_API_KEY",
  "CALCOM_EVENT_TYPE_ID",
  "TWILIO_TEST_ACCOUNT_SID",
  "TWILIO_TEST_AUTH_TOKEN",
  "NTFY_SERVER",
  "NTFY_TOPIC",
  "CLIENT_ID",
  "VAPI_PRIVATE_KEY",
  "DASHBOARD_ADMIN_PASSCODE",
];

const env = loadEnv({ quiet: true }).parsed ?? {};
const set = APP_VARS.filter((k) => env[k]?.trim());
const missing = APP_VARS.filter((k) => !env[k]?.trim());

writeFileSync(".env.vercel", set.map((k) => `${k}=${env[k].trim()}`).join("\n") + "\n");
console.log(`Wrote .env.vercel with ${set.length} variables: ${set.join(", ")}`);
if (missing.length) console.log(`Not set yet (add later and rerun): ${missing.join(", ")}`);
