# Account setup (Lat does these; about 30 to 40 minutes)

Each step ends with what to paste into `.env` (in the repo root; already created, never committed).
`VAPI_WEBHOOK_SECRET` and `NTFY_TOPIC` are already filled in for you.
Use latczar@gmail.com for every sign-up.

Do them in this order: the first two unblock the first working call.

## 1. Vapi (needed first)
1. Sign up at https://dashboard.vapi.ai.
2. Left menu: **API Keys** (under your organisation). Copy:
   - Private key → `VAPI_PRIVATE_KEY`
   - Public key → `NEXT_PUBLIC_VAPI_PUBLIC_KEY`
3. Check the credit balance (top of the dashboard). Sign-up credit is enough to start; top up $10 to $20 later if needed.
4. Don't create assistants, tools or phone numbers by hand. The provisioning script does that.

## 2. Supabase (needed first)
1. Sign up at https://supabase.com, **New project**: name `ella-jrco`, region **East US (North Virginia)** (closest to Vercel's default region), set a database password and save it somewhere safe.
2. **Project Settings > API Keys**. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon (or "publishable") key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role (or "secret") key → `SUPABASE_SERVICE_ROLE_KEY`
3. Top bar **Connect** > **Session pooler** > copy the URI **as is** (leave `[YOUR-PASSWORD]` in it) → `SUPABASE_DB_URL`.
4. The database password → `SUPABASE_DB_PASSWORD`. The script fills it into the URI and handles symbols like `@`.

## 3. Vercel
1. Sign up at https://vercel.com (Hobby plan; signing in with GitHub is easiest).
2. In a terminal in the repo, run `npx vercel login` and follow the prompts. Nothing to paste; I'll deploy from the CLI.

## 4. HubSpot
1. Sign up for the free CRM at https://www.hubspot.com.
2. Left sidebar: **Development > Legacy apps**. New accounts can't create legacy apps, so click **Create a service key** (it replaces private apps). Name it `Ella`.
3. Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write` and `tickets`. If you also see task or note scopes (`crm.objects.tasks`, `crm.objects.notes`), tick their read and write too.
4. Create it and copy the key → `HUBSPOT_PRIVATE_APP_TOKEN` (the name is kept from private apps; a service key is used the same way, as a Bearer token).

## 5. Cal.com
1. Sign up at https://cal.com. Set your timezone to **America/Chicago** (JR&CO is assumed to be in US Central time).
2. **Event Types > New**: title `Free roof inspection`, 60 minutes, location "In person (attendee address)". Save.
3. Open the event type; the number in the browser address bar is its ID → `CALCOM_EVENT_TYPE_ID`.
4. **Settings > Developer > API keys > New**, never expires → `CALCOM_API_KEY` (starts `cal_live_`).

## 6. Twilio (test credentials only)
1. Sign up for a trial at https://www.twilio.com (needs phone verification). Don't buy a number.
2. **Console > Account > API keys & tokens > Test credentials**. Copy:
   - Test Account SID → `TWILIO_TEST_ACCOUNT_SID`
   - Test Auth Token → `TWILIO_TEST_AUTH_TOKEN`

## 7. ntfy (on your phone)
1. Install **ntfy** from the App Store or Play Store.
2. Tap **+**, server `ntfy.sh`, topic: the `NTFY_TOPIC` value in your `.env`. Emergency alerts will arrive here.

## 8. BetterStack (uptime monitor and status page)
1. Sign up at betterstack.com (free plan).
2. Uptime → **Settings → API tokens** → under the team, **Create API token** (an Uptime token, not a Telemetry one).
3. Put it in `.env` as `BETTERSTACK_API_TOKEN`. It's only used locally by `npm run uptime`, so it doesn't go on Vercel.
4. `npm run uptime` creates the monitor and the public status page (rerunning updates them).

When a section is done, tell me which one and I'll check the keys work (I never print them back).
