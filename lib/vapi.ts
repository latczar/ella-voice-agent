// Minimal Vapi REST client for the scripts. Server-side only (uses the private key).
// In dry-run mode, writes are printed instead of sent, and reads return nothing,
// so provisioning can be checked without a Vapi account.

const BASE_URL = "https://api.vapi.ai";

export class VapiError extends Error {
  constructor(public readonly status: number, public readonly method: string, public readonly path: string, body: string) {
    super(`Vapi ${method} ${path} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = "VapiError";
  }
}

export interface VapiClientOptions {
  apiKey?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export class VapiClient {
  private readonly apiKey: string;
  readonly dryRun: boolean;
  private readonly log: (line: string) => void;
  private dryRunCounter = 0;

  constructor(opts: VapiClientOptions = {}) {
    this.dryRun = opts.dryRun ?? false;
    this.log = opts.log ?? console.log;
    this.apiKey = opts.apiKey ?? process.env.VAPI_PRIVATE_KEY ?? "";
    if (!this.dryRun && !this.apiKey) {
      throw new Error("VAPI_PRIVATE_KEY is not set. Add it to .env (see docs/account-setup.md), or run with --dry-run.");
    }
  }

  async get<T>(path: string): Promise<T | null> {
    if (this.dryRun) return null;
    return this.request<T>("GET", path);
  }

  async list<T>(path: string): Promise<T[]> {
    if (this.dryRun) return [];
    return (await this.request<T[]>("GET", path)) ?? [];
  }

  async create<T extends { id: string }>(path: string, body: unknown): Promise<T> {
    if (this.dryRun) {
      this.printDryRun("POST", path, body);
      return { id: `dry-run-${++this.dryRunCounter}` } as T;
    }
    return (await this.request<T>("POST", path, body))!;
  }

  async update<T extends { id: string }>(path: string, body: unknown): Promise<T> {
    if (this.dryRun) {
      this.printDryRun("PATCH", path, body);
      return { id: path.split("/").pop()! } as T;
    }
    return (await this.request<T>("PATCH", path, body))!;
  }

  /** Returns null on 404, so callers can tell "gone" from "failed". */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && method === "GET") return null;
    const text = await res.text();
    if (!res.ok) throw new VapiError(res.status, method, path, text);
    return text ? (JSON.parse(text) as T) : null;
  }

  private printDryRun(method: string, path: string, body: unknown): void {
    const json = JSON.stringify(body, null, 2);
    const preview = json.length > 1500 ? `${json.slice(0, 1500)}\n  ... (${json.length} chars)` : json;
    this.log(`[dry run] ${method} ${path}\n${preview}\n`);
  }
}
