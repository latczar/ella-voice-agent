// HubSpot CRM (free tier, private app token). Contacts are upserted by email or phone so
// repeat callers don't create duplicates; call details go in a note, and follow-ups become a
// task (call-backs, emergencies) or a ticket (the billing queue).
// Docs: developers.hubspot.com/docs/api-reference (contacts, tasks, tickets, notes v3).

const BASE = "https://api.hubapi.com";

// HUBSPOT_DEFINED association type IDs (from-object to contact).
const ASSOC = { taskToContact: 204, ticketToContact: 16, noteToContact: 202 } as const;

async function hs<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface ContactInput {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null; // E.164
  address?: string | null;
  company?: string | null;
}

function splitName(full?: string | null): { firstname?: string; lastname?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  return parts.length === 1 ? { firstname: parts[0] } : { firstname: parts.slice(0, -1).join(" "), lastname: parts.at(-1) };
}

/** US national number (10 digits) from E.164, for matching numbers stored without +1. */
function national(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

async function findContact(c: ContactInput): Promise<string | null> {
  const groups: object[] = [];
  if (c.email) groups.push({ filters: [{ propertyName: "email", operator: "EQ", value: c.email.toLowerCase() }] });
  if (c.phone) {
    groups.push({ filters: [{ propertyName: "phone", operator: "EQ", value: c.phone }] });
    groups.push({ filters: [{ propertyName: "phone", operator: "EQ", value: national(c.phone) }] });
  }
  if (!groups.length) return null;
  const res = await hs<{ results: { id: string }[] }>("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: groups, properties: ["email", "phone"], limit: 1, after: "0", sorts: [], query: "",
  });
  return res.results[0]?.id ?? null;
}

/** Create or update the contact; returns its ID. Only fields we have are sent. */
export async function upsertContact(c: ContactInput): Promise<string> {
  const properties = Object.fromEntries(
    Object.entries({
      ...splitName(c.fullName),
      email: c.email?.toLowerCase(),
      phone: c.phone,
      address: c.address,
      company: c.company,
    }).filter(([, v]) => v),
  );
  const existing = await findContact(c);
  if (existing) {
    await hs("PATCH", `/crm/v3/objects/contacts/${existing}`, { properties });
    return existing;
  }
  const created = await hs<{ id: string }>("POST", "/crm/v3/objects/contacts", { properties: { ...properties, lifecyclestage: "lead" } });
  return created.id;
}

const assoc = (contactId: string, typeId: number) => [
  { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] },
];

export async function addNote(contactId: string, body: string): Promise<string> {
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/notes", {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body.slice(0, 60000) },
    associations: assoc(contactId, ASSOC.noteToContact),
  });
  return res.id;
}

export async function createTask(contactId: string, subject: string, body: string, priority: "LOW" | "MEDIUM" | "HIGH"): Promise<string> {
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/tasks", {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_task_subject: subject.slice(0, 250),
      hs_task_body: body.slice(0, 60000),
      hs_task_status: "NOT_STARTED",
      hs_task_priority: priority,
      hs_task_type: "CALL",
    },
    associations: assoc(contactId, ASSOC.taskToContact),
  });
  return res.id;
}

let ticketStage: { pipeline: string; stage: string } | null = null;

/** First stage of the first ticket pipeline (the free tier's default Support Pipeline). */
async function defaultTicketStage(): Promise<{ pipeline: string; stage: string }> {
  if (ticketStage) return ticketStage;
  const res = await hs<{ results: { id: string; stages: { id: string; displayOrder: number }[] }[] }>("GET", "/crm/v3/pipelines/tickets");
  const pipeline = res.results[0];
  if (!pipeline) throw new Error("HubSpot has no ticket pipeline");
  const stage = [...pipeline.stages].sort((a, b) => a.displayOrder - b.displayOrder)[0];
  ticketStage = { pipeline: pipeline.id, stage: stage.id };
  return ticketStage;
}

export async function createTicket(contactId: string, subject: string, content: string, priority: "LOW" | "MEDIUM" | "HIGH"): Promise<string> {
  const { pipeline, stage } = await defaultTicketStage();
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/tickets", {
    properties: { subject: subject.slice(0, 250), content: content.slice(0, 60000), hs_pipeline: pipeline, hs_pipeline_stage: stage, hs_ticket_priority: priority },
    associations: assoc(contactId, ASSOC.ticketToContact),
  });
  return res.id;
}
