// Text alerts, switched by the client config's alerts.sms_mode:
//   test - Twilio TEST credentials and the magic sender +15005550006: Twilio validates the
//          request and returns a real-looking response, but sends and charges nothing.
//   push - the text is delivered as an ntfy push instead, so a real alert reaches a phone.
//   live - real Twilio SMS. Refused in this build: US numbers need A2P 10DLC registration.

import type { ClientConfig } from "../config";
import { sendPush } from "./ntfy";

export interface SmsResult {
  to: string;
  ok: boolean;
  mode: ClientConfig["alerts"]["sms_mode"];
  id?: string;
  error?: string;
}

export async function sendSms(config: ClientConfig, to: string[], body: string, title = "Text alert"): Promise<SmsResult[]> {
  const mode = config.alerts.sms_mode;

  if (mode === "push") {
    const topic = process.env[config.alerts.push.topic_env] ?? "";
    const res = await sendPush(topic, { title: `${title} (SMS to ${to.join(", ")})`, message: body, priority: "high", tags: ["speech_balloon"] });
    return to.map((n) => ({ to: n, ok: res.ok, mode, error: res.error }));
  }

  if (mode === "live") {
    return to.map((n) => ({ to: n, ok: false, mode, error: "Live SMS is disabled in this build (needs A2P 10DLC registration)." }));
  }

  const sid = process.env.TWILIO_TEST_ACCOUNT_SID;
  const token = process.env.TWILIO_TEST_AUTH_TOKEN;
  if (!sid || !token) return to.map((n) => ({ to: n, ok: false, mode, error: "Twilio test credentials are not set" }));
  const from = config.alerts.twilio_test_from ?? "+15005550006";

  return Promise.all(
    to.map(async (n): Promise<SmsResult> => {
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: n, From: from, Body: body }),
          signal: AbortSignal.timeout(6000),
        });
        const json = (await res.json()) as { sid?: string; message?: string; code?: number };
        return res.ok ? { to: n, ok: true, mode, id: json.sid } : { to: n, ok: false, mode, error: `Twilio ${json.code ?? res.status}: ${json.message ?? "error"}` };
      } catch (err) {
        return { to: n, ok: false, mode, error: `Twilio request failed: ${(err as Error).message}` };
      }
    }),
  );
}
