// Checks each integration's credentials with a harmless real request, using synthetic data.
// Usage: npm run check            all integrations that have keys in .env
//        npm run check -- --push  also send a test push to the ntfy topic
// HubSpot: creates a synthetic contact, note, task and ticket, then deletes them.
// Twilio: uses test credentials and Twilio's magic numbers (nothing is sent or charged).
// Cal.com: reads available slots only (no booking).

import "dotenv/config";
import { loadConfig } from "../lib/config";
import { getSlots, eventTypeId } from "../lib/integrations/calcom";
import { addNote, createTask, createTicket, deleteObject, upsertContact } from "../lib/integrations/hubspot";
import { sendPush } from "../lib/integrations/ntfy";
import { sendSms } from "../lib/integrations/sms";

const config = loadConfig(process.env.CLIENT_ID ?? "jrco");
const withPush = process.argv.includes("--push");
let failures = 0;

async function check(name: string, needs: string[], fn: () => Promise<string>): Promise<void> {
  const missing = needs.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`  --    ${name.padEnd(9)} skipped (not set: ${missing.join(", ")})`);
    return;
  }
  try {
    console.log(`  ok    ${name.padEnd(9)} ${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name.padEnd(9)} ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log("Integration checks (synthetic data only)\n");

  await check("Supabase", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], async () => {
    const { db } = await import("../lib/server/db");
    const { count, error } = await db()!.from("calls").select("id", { count: "exact", head: true });
    if (error || count === null) throw new Error(`${error?.message ?? "no response from the calls table"} (check the Supabase URL, and that npm run db:apply has run)`);
    return `connected; ${count ?? 0} calls stored`;
  });

  await check("HubSpot", ["HUBSPOT_PRIVATE_APP_TOKEN"], async () => {
    const contactId = await upsertContact({ fullName: "Integration Check", email: "integration-check@example.com", phone: "+13125550199" });
    const steps = [`contact ${contactId}`];
    const cleanup: [Parameters<typeof deleteObject>[0], string][] = [];
    const tryStep = async (label: string, type: Parameters<typeof deleteObject>[0], fn: () => Promise<string>) => {
      try {
        cleanup.push([type, await fn()]);
        steps.push(`${label} ok`);
      } catch (err) {
        steps.push(`${label} FAILED (${(err as Error).message.slice(0, 160)})`);
        failures++;
      }
    };
    await tryStep("note", "notes", () => addNote(contactId, "Integration check note (synthetic)."));
    await tryStep("task", "tasks", () => createTask(contactId, "Integration check task", "Synthetic; deleted straight away.", "LOW"));
    await tryStep("ticket", "tickets", () => createTicket(contactId, "Integration check ticket", "Synthetic; deleted straight away.", "LOW"));
    for (const [type, id] of cleanup) await deleteObject(type, id);
    await deleteObject("contacts", contactId);
    return `${steps.join(", ")}; all test records deleted`;
  });

  await check("Cal.com", ["CALCOM_API_KEY", config.calendar.event_type_id_env], async () => {
    const slots = await getSlots(eventTypeId(config.calendar.event_type_id_env), config.locale.timezone, config.calendar.lookahead_days);
    return `${slots.length} free slots in the next ${config.calendar.lookahead_days} days${slots[0] ? `; first: ${slots[0].spoken}` : " (check the event type's availability)"}`;
  });

  await check("Twilio", ["TWILIO_TEST_ACCOUNT_SID", "TWILIO_TEST_AUTH_TOKEN"], async () => {
    // Force test mode whatever the config says; +15005550006 is Twilio's valid test sender.
    const [res] = await sendSms({ ...config, alerts: { ...config.alerts, sms_mode: "test" } }, ["+13125550101"], "Integration check (test credentials; nothing is sent).");
    if (!res.ok) throw new Error(res.error);
    return `test message accepted (${res.id})`;
  });

  await check("ntfy", [config.alerts.push.topic_env], async () => {
    if (!withPush) return "topic set (run with --push to send a test notification)";
    const res = await sendPush(process.env[config.alerts.push.topic_env]!, { title: "Ella: test notification", message: "If you can read this on your phone, push alerts work.", tags: ["white_check_mark"] });
    if (!res.ok) throw new Error(res.error);
    return "test notification sent; check your phone";
  });

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll configured integrations work.");
  process.exit(failures ? 1 : 0);
}

main();
