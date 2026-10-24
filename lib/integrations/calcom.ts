// Cal.com API v2: free inspection slots and bookings.
// Docs: cal.com/docs/api-reference/v2 (slots: cal-api-version 2024-09-04; bookings: 2026-02-25).

const BASE = "https://api.cal.com/v2";

function headers(version: string): HeadersInit {
  const key = process.env.CALCOM_API_KEY;
  if (!key) throw new Error("CALCOM_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "cal-api-version": version, "Content-Type": "application/json" };
}

export function eventTypeId(envName: string): number {
  const id = Number(process.env[envName]);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${envName} is not set to a Cal.com event type ID`);
  return id;
}

export interface Slot {
  start: string; // ISO 8601 with offset
  spoken: string; // e.g. "Tuesday, October 27 at 9 AM"
}

/** Available start times between now and `days` ahead, in the client's timezone. */
export async function getSlots(eventType: number, timeZone: string, days: number): Promise<Slot[]> {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({ eventTypeId: String(eventType), start: start.toISOString(), end: end.toISOString(), timeZone });
  const res = await fetch(`${BASE}/slots?${params}`, { headers: headers("2024-09-04"), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Cal.com slots returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data?: Record<string, Array<{ start: string } | string>> };
  return Object.values(json.data ?? {})
    .flat()
    .map((s) => (typeof s === "string" ? s : s.start))
    .map((iso) => ({ start: iso, spoken: spokenDateTime(iso, timeZone) }));
}

export interface BookingInput {
  eventTypeId: number;
  start: string;
  name: string;
  email: string;
  phone?: string;
  address: string;
  timeZone: string;
  notes?: string;
  callId: string;
}

export interface Booking {
  id: number;
  uid: string;
  status: string;
  start: string;
}

export async function createBooking(b: BookingInput): Promise<Booking> {
  const body = {
    start: new Date(b.start).toISOString(),
    eventTypeId: b.eventTypeId,
    attendee: { name: b.name, email: b.email, timeZone: b.timeZone, ...(b.phone ? { phoneNumber: b.phone } : {}) },
    location: { type: "attendeeAddress", address: b.address },
    metadata: { call_id: b.callId.slice(0, 500), source: "Ella" },
    ...(b.notes ? { bookingFieldsResponses: { notes: b.notes.slice(0, 500) } } : {}),
  };
  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: headers("2026-02-25"),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Cal.com booking returned ${res.status}: ${text.slice(0, 300)}`);
  const data = (JSON.parse(text) as { data: Booking | Booking[] }).data;
  return Array.isArray(data) ? data[0] : data;
}

export function spokenDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
  return `${day} at ${time}`;
}
