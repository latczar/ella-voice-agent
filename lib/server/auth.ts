// Every Vapi webhook must carry the shared secret header set by provisioning.
import { timingSafeEqual } from "node:crypto";
import { SECRET_HEADER } from "../constants";

export function hasValidSecret(req: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  const given = req.headers.get(SECRET_HEADER);
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
