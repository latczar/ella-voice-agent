// Liveness check for uptime monitoring. Reports which integrations are configured,
// never their values.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const configured = (name: string) => Boolean(process.env[name]);
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    integrations: {
      vapi_webhook_secret: configured("VAPI_WEBHOOK_SECRET"),
      supabase: configured("NEXT_PUBLIC_SUPABASE_URL") && configured("SUPABASE_SERVICE_ROLE_KEY"),
      hubspot: configured("HUBSPOT_PRIVATE_APP_TOKEN"),
      calcom: configured("CALCOM_API_KEY") && configured("CALCOM_EVENT_TYPE_ID"),
      twilio_test: configured("TWILIO_TEST_ACCOUNT_SID") && configured("TWILIO_TEST_AUTH_TOKEN"),
      ntfy: configured("NTFY_TOPIC"),
    },
  });
}
