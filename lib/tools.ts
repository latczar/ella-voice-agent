// In-call tool definitions: name, description, strict parameters and spoken lines.
// lib/vapi-resources.ts wraps these into Vapi's tool format; app/api/vapi/tools
// handles the calls. Descriptions are written for the model: when to call, not how it works.

import type { ClientConfig } from "./config";

export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | null)[];
  items?: JsonSchema;
  additionalProperties?: boolean;
  format?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Spoken while the tool runs (only for tools that may take a moment). "" = say nothing, overriding Vapi's default filler. */
  saysWhileRunning?: string;
  /** Spoken if the tool fails or times out, so the caller never hears silence. */
  saysOnFailure: string;
  timeoutSeconds: number;
}

/** Name of the hand-off or transfer tool for a department, e.g. transfer_to_residential_sales. */
export const transferToolName = (departmentKey: string): string => `transfer_to_${departmentKey}`;

const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", description, ...extra });

export function toolSpecs(c: ClientConfig): ToolSpec[] {
  const departmentKeys = Object.keys(c.departments);
  const intentIds = c.intents.map((i) => i.id);
  const callerNeeds = [...new Set(c.intents.map((i) => i.caller_need))];

  return [
    {
      name: "check_hours",
      description:
        "Check whether a department can take a transfer right now, before choosing between a transfer and the after-hours option. Returns can_transfer (true or false) and, if not, when the team is next available.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["department"],
        properties: { department: str("The department the caller needs.", { enum: departmentKeys }) },
      },
      saysWhileRunning: "", // instant; no filler
      saysOnFailure: "Let me take your details and make sure the right person calls you back.",
      timeoutSeconds: 10,
    },
    {
      name: "log_lead",
      description:
        "Save the caller's details and what they need. Call it as soon as you have the route's required details, before any transfer or booking, and again if you learn something important. Include only details the caller actually gave.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["intent", "caller_need", "summary"],
        properties: {
          intent: str("The routing intent.", { enum: intentIds }),
          caller_need: str("Caller need category.", { enum: callerNeeds }),
          full_name: str("Caller's full name."),
          phone: str("Only if the caller gave a different number from the one they're calling from, in E.164. Leave empty otherwise: the system adds the caller's number."),
          email: str("Email address, if given."),
          property_address: str("Full property address including city and ZIP, as confirmed with the caller."),
          property_type: str("Residential or commercial property.", { enum: ["residential", "commercial"] }),
          company_name: str("Company name (commercial callers and suppliers)."),
          facility_type: str("Type of commercial facility, e.g. warehouse, retail, office, multi-family."),
          roof_size_or_buildings: str("Rough roof size or number of buildings, in the caller's words."),
          pm_name: str("Name of the caller's project manager (existing customers)."),
          invoice_or_account_number: str("Invoice or account number (billing and suppliers)."),
          urgency: str("How urgent this is.", { enum: ["emergency", "high", "normal"] }),
          callback_requested: { type: "boolean", description: "True if the caller should be called back (after hours, unanswered transfer, or at their request)." },
          sms_opt_in: { type: "boolean", description: "True only if the caller agreed to receive text messages." },
          summary: str("One or two sentences on what the caller needs, for the team's notes."),
        },
      },
      saysWhileRunning: "", // instant; no filler
      saysOnFailure: "I've made a note of that.",
      timeoutSeconds: 10,
    },
    {
      name: "send_emergency_alert",
      description:
        "Instantly alert the on-call dispatch team by text and push notification about an active leak or storm damage. Call it as soon as you have the property address, before transferring. Use it only for emergencies.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["property_address", "summary", "danger_reported"],
        properties: {
          property_address: str("Property address as confirmed with the caller."),
          callback_number: str("Caller's confirmed number in E.164."),
          caller_name: str("Caller's name, if known."),
          summary: str("Short description of the damage, e.g. 'Water coming through bedroom ceiling after hail'."),
          danger_reported: { type: "boolean", description: "True if the caller mentioned any danger to people (collapse risk, electrics, gas, injury)." },
        },
      },
      saysWhileRunning: "I'm alerting our on-call team now.",
      saysOnFailure: "I'm connecting you to our on-call manager now.",
      timeoutSeconds: 15,
    },
    {
      name: "check_availability",
      description: `Get the next available free inspection times. Call it when an after-hours residential caller wants to book. Offer the caller at most ${c.calendar.slots_to_offer} of the returned times.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          preferred_day: str("Day the caller prefers, if they said one, e.g. 'Tuesday' or 'next week'."),
        },
      },
      saysWhileRunning: "Let me check what we have open.",
      saysOnFailure: "I can't see the calendar right now, but I'll have the team call you first thing to set up your inspection.",
      timeoutSeconds: 15,
    },
    {
      name: "book_appointment",
      description:
        "Book a free roof inspection at a time from check_availability, after the caller agrees to that exact time. You need their name, phone, email and the property address first.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["start_time", "full_name", "email", "property_address"],
        properties: {
          start_time: str("The chosen slot's start time, exactly as returned by check_availability (ISO 8601)."),
          full_name: str("Caller's full name."),
          phone: str("Only if different from the number they're calling from, in E.164."),
          email: str("Caller's email, needed for the booking confirmation.", { format: "email" }),
          property_address: str("Property address for the inspection."),
          notes: str("Anything the inspector should know."),
        },
      },
      saysWhileRunning: "Booking that for you now.",
      saysOnFailure: "I couldn't book that just now, but I'll have the team call you first thing to confirm a time.",
      timeoutSeconds: 20,
    },
  ];
}
