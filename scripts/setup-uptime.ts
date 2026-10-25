// Uptime monitoring: creates or updates a BetterStack monitor on the deployed /api/health
// and a public status page that shows it. Idempotent: IDs are saved in
// configs/state/<client>.uptime.json, and anything missing from there is looked up by
// URL or subdomain before creating, so a rerun updates rather than duplicates.
// Usage: npm run uptime   (needs BETTERSTACK_API_TOKEN and PUBLIC_BASE_URL in .env)

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, REPO_ROOT } from "../lib/config";

const API = "https://uptime.betterstack.com/api/v2";
const CHECK_FREQUENCY_S = 180; // the free plan's shortest interval (3 minutes)

interface UptimeState {
  client_id: string;
  updated_at: string | null;
  health_url: string | null;
  monitor_id: string | null;
  status_page_id: string | null;
  status_page_resource_id: string | null;
  status_page_url: string | null;
}

interface Item {
  id: string;
  attributes: Record<string, unknown>;
}

const token = process.env.BETTERSTACK_API_TOKEN?.trim();
const config = loadConfig(process.env.CLIENT_ID ?? "jrco");
const baseUrl = (process.env.PUBLIC_BASE_URL?.trim() || "https://ella-voice-agent.vercel.app").replace(/\/+$/, "");
const healthUrl = `${baseUrl}/api/health`;
const subdomain = `${config.client_id}-${config.agent.name}-status`.toLowerCase().replace(/[^a-z0-9-]/g, "");
const statePath = path.join(REPO_ROOT, "configs", "state", `${config.client_id}.uptime.json`);

async function api(method: string, route: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 404 && method === "GET") return { status: 404, data: null };
  if (!res.ok) {
    const hint = res.status === 401 ? " (check BETTERSTACK_API_TOKEN is an Uptime API token)" : "";
    throw new Error(`BetterStack ${method} ${route} failed: ${res.status}${hint} ${text.slice(0, 400)}`);
  }
  return { status: res.status, data };
}

/** Every item from a paginated list endpoint. */
async function list(route: string): Promise<Item[]> {
  const items: Item[] = [];
  let next: string | null = route;
  while (next) {
    const { data } = (await api("GET", next)) as { data: { data: Item[]; pagination?: { next: string | null } } };
    items.push(...data.data);
    next = data.pagination?.next ? data.pagination.next.replace(API, "") : null;
  }
  return items;
}

async function existing(route: string, id: string | null): Promise<Item | null> {
  if (!id) return null;
  const { status, data } = await api("GET", `${route}/${id}`);
  return status === 404 ? null : (data as { data: Item }).data;
}

function readState(): UptimeState {
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath, "utf8")) as UptimeState;
  return {
    client_id: config.client_id, updated_at: null, health_url: null, monitor_id: null,
    status_page_id: null, status_page_resource_id: null, status_page_url: null,
  };
}

async function main(): Promise<void> {
  if (!token) throw new Error("BETTERSTACK_API_TOKEN is not set in .env (see docs/account-setup.md, section 8).");
  const state = readState();

  // 1. Monitor on /api/health. It returns 503 when the database is unreachable.
  const monitorBody = {
    monitor_type: "status",
    url: healthUrl,
    pronounceable_name: `${config.agent.name} (${config.business.name}) health`,
    check_frequency: CHECK_FREQUENCY_S,
    request_timeout: 15,
    verify_ssl: true,
    email: true,
  };
  let monitor =
    (await existing("/monitors", state.monitor_id)) ??
    (await list(`/monitors?url=${encodeURIComponent(healthUrl)}`)).find((m) => m.attributes.url === healthUrl) ??
    null;
  if (monitor) {
    await api("PATCH", `/monitors/${monitor.id}`, monitorBody);
    console.log(`  updated  monitor ${monitor.id}`);
  } else {
    monitor = ((await api("POST", "/monitors", monitorBody)).data as { data: Item }).data;
    console.log(`  created  monitor ${monitor.id}`);
  }

  // 2. Public status page.
  const pageBody = {
    company_name: config.business.name,
    company_url: baseUrl,
    subdomain,
    timezone: config.locale.timezone,
    subscribable: false,
  };
  let page =
    (await existing("/status-pages", state.status_page_id)) ??
    (await list("/status-pages")).find((p) => p.attributes.subdomain === subdomain) ??
    null;
  if (page) {
    page = ((await api("PATCH", `/status-pages/${page.id}`, pageBody)).data as { data: Item }).data;
    console.log(`  updated  status page ${page.id}`);
  } else {
    page = ((await api("POST", "/status-pages", pageBody)).data as { data: Item }).data;
    console.log(`  created  status page ${page.id}`);
  }

  // 3. The monitor, shown on the status page.
  const resources = await list(`/status-pages/${page.id}/resources`);
  let resource = resources.find((r) => String(r.attributes.resource_id) === String(monitor!.id)) ?? null;
  const resourceBody = { resource_id: Number(monitor.id), resource_type: "Monitor", public_name: `${config.agent.name}, the AI receptionist` };
  if (resource) {
    await api("PATCH", `/status-pages/${page.id}/resources/${resource.id}`, resourceBody);
    console.log(`  updated  status page resource ${resource.id}`);
  } else {
    resource = ((await api("POST", `/status-pages/${page.id}/resources`, resourceBody)).data as { data: Item }).data;
    console.log(`  created  status page resource ${resource.id}`);
  }

  const customDomain = page.attributes.custom_domain as string | null | undefined;
  const pageUrl = customDomain ? `https://${customDomain}` : `https://${page.attributes.subdomain}.betteruptime.com`;
  const next: UptimeState = {
    client_id: config.client_id,
    updated_at: new Date().toISOString(),
    health_url: healthUrl,
    monitor_id: monitor.id,
    status_page_id: page.id,
    status_page_resource_id: resource.id,
    status_page_url: pageUrl,
  };
  writeFileSync(statePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nMonitor: ${healthUrl} every ${CHECK_FREQUENCY_S / 60} minutes`);
  console.log(`Status page: ${pageUrl}`);
  console.log(`Saved IDs to ${path.relative(REPO_ROOT, statePath)}`);
}

main().catch((err) => {
  console.error(`Uptime setup failed: ${(err as Error).message}`);
  process.exit(1);
});
