// Renders the system prompts from prompts/*.md.tmpl, the client config and the KB.
// Everything the templates need is computed here, so the templates stay readable.

import { readFileSync } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import type { ClientConfig, LeadField } from "./config";
import { REPO_ROOT } from "./config";
import { kbAsPromptText } from "./kb";
import { transferToolName } from "./tools";

const FIELD_LABELS: Record<LeadField, string> = {
  full_name: "full name",
  phone: "phone (the number they're calling from, or one they give)",
  email: "email",
  property_address: "property address",
  property_type: "residential or commercial",
  caller_need: "caller need",
  pm_name: "project manager's name",
  invoice_or_account_number: "invoice or account number",
  company_name: "company name",
  facility_type: "facility type",
  roof_size_or_buildings: "rough roof size or number of buildings",
};

const CALLER_NEEDS = ["New Roof", "Repair", "Storm Damage", "Billing", "Existing Project Status", "Supplier or Accounts Payable", "Other"];

function template(name: string): HandlebarsTemplateDelegate {
  const source = readFileSync(path.join(REPO_ROOT, "prompts", name), "utf8");
  // noEscape: this is plain text for an LLM, not HTML. strict: a missing value is an error, not a blank.
  return Handlebars.compile(source, { noEscape: true, strict: true });
}

/** Vapi fills these Liquid variables at call time. */
function vapiVariables(c: ClientConfig) {
  return {
    // Spelled out when there's no number (browser calls), so the model never fills a blank with a guess.
    now: `{{"now" | date: "%A, %B %-d, %Y, %-I:%M %p", "${c.locale.timezone}"}}`,
  };
}

export function renderSystemPrompt(c: ClientConfig): string {
  const emergency = c.intents.find((i) => i.emergency);
  const view = {
    ...c,
    tone: c.agent.tone.join(", "),
    callerNeeds: CALLER_NEEDS.join(", "),
    transferTools: Object.keys(c.departments).map(transferToolName).join(", "),
    vapi: vapiVariables(c),
    emergencyDepartmentName: emergency?.department ? c.departments[emergency.department].name : "the on-call team",
    intents: c.intents.map((i) => ({
      ...i,
      emergency: Boolean(i.emergency),
      departmentName: i.department ? c.departments[i.department].name : null,
      transferType: i.department ? c.departments[i.department].transfer_type : null,
      transferTool: i.department ? transferToolName(i.department) : null,
      requiredFields: i.required_fields.map((f) => FIELD_LABELS[f]).join(", "),
    })),
    kb: c.kb.mode === "prompt" ? kbAsPromptText(c) : "Use the knowledge base search tool for questions about services, materials, warranties and process.",
  };
  return tidy(template("system.md.tmpl")(view));
}

export function renderDepartmentPrompt(c: ClientConfig, departmentKey: string): string {
  const department = c.departments[departmentKey];
  if (!department) throw new Error(`Unknown department "${departmentKey}"`);
  const handles = c.intents.filter((i) => i.department === departmentKey).map((i) => i.label.toLowerCase());
  const view = {
    ...c,
    department,
    persona: department.persona,
    departmentDuty: `You handle: ${handles.join("; ")}.`,
  };
  return tidy(template("department.md.tmpl")(view));
}

/** The department assistant's opening line when the call connects. */
export function departmentFirstMessage(c: ClientConfig, departmentKey: string): string {
  return `${c.departments[departmentKey].persona.greeting} I've got your details from ${c.agent.name}.`;
}

function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
