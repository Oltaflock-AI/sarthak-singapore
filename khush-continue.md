# Khush — Handoff Doc

Everything you need to finish setting up and demo the Sarthak Singapore AI Sales Engine.

**Last updated:** May 2026 · by Amaan

---

## Where Everything Lives

| Thing | Where |
|-------|-------|
| Live dashboard | https://sarthak-singapore.vercel.app |
| GitHub repo | https://github.com/Oltaflock-AI/sarthak-singapore |
| Vercel project | sarthak-singapore (auto-deploys on push to `main`) |
| Supabase project | https://supabase.com/dashboard/project/yhwoqmhnvzpfgacfaidg |
| Ringg.ai assistant | https://www.ringg.ai/dashboard/assistants/86ee188a-38cf-49fb-a2d1-e1305759e84f |
| Meta WhatsApp app | https://developers.facebook.com/apps/653595474481511 |
| Local project folder | `/Users/amaanbarmare/Desktop/sarthak-real-estate` |

---

## What's Already Done

- ✅ Next.js 16 app deployed on Vercel
- ✅ Supabase tables (`calls`, `wa_messages`) live with proper schema + unique constraint on `call_id`
- ✅ Ringg.ai webhook endpoint live: `/api/ringg/webhook` (accepts call data, writes to Supabase)
- ✅ WhatsApp webhook endpoint live: `/api/whatsapp/webhook` (handles Meta verification + incoming messages + Priya replies via GPT-4.1-mini)
- ✅ Meta webhook **verified and subscribed** to `messages` field
- ✅ Dashboard has 5 working pages: Overview, Voice Calls, WhatsApp, Leads (kanban), Projects
- ✅ All KPIs and charts pull from real Supabase data
- ✅ Persistent sidebar with live counts

---

## What's Still To Do

### 1. Test the WhatsApp Bot End-to-End

The verified test number on Meta is `+1 (609) 582-5588`. To test:

1. Open Meta Developer → Wapp_Automation → WhatsApp → **API Setup**
2. Confirm `+1 (609) 582-5588` is in the **To** field (or add your own number — see below)
3. Click the blue **Send message** button — this sends the `hello_world` template to the verified number
4. On that phone's WhatsApp, you should receive the hello_world message
5. **Reply** with something like: `Hi, mujhe 3BHK chahiye Grand Virasat mein`
6. Within 2-3 seconds, **Priya** (the AI) should reply in Hindi
7. Check the dashboard's **WhatsApp** tab — your conversation appears within 10s

#### Adding Your Own Phone Number (Indian or otherwise)

1. On the API Setup page, click the dropdown next to the **To** field
2. **Manage phone number list** → **Add phone number**
3. Enter your number with country code (e.g. `+91 XXXXX XXXXX`)
4. Meta sends a verification code **on WhatsApp** (not SMS) — enter it
5. Switch the **To** dropdown to your number, then test as above

#### If WhatsApp Doesn't Work

| Symptom | Fix |
|---------|-----|
| No reply from Priya | Check Vercel function logs at vercel.com → Functions → `/api/whatsapp/webhook` |
| "24-hour window closed" | Send `hello_world` template again to reopen the customer service window |
| Reply works but doesn't show on dashboard | Refresh — dashboard polls every 10s |
| Webhook not firing | Re-verify in Meta → WhatsApp → Configuration. Verify token must match `META_VERIFY_TOKEN` |

---

### 2. Finish Ringg.ai Webhook Setup

The webhook endpoint is live but Ringg.ai isn't pointing to it yet.

1. Open the [Sarthak Singapore assistant on Ringg.ai](https://www.ringg.ai/dashboard/assistants/86ee188a-38cf-49fb-a2d1-e1305759e84f)
2. In the left sidebar under **Advanced Settings**, click **Event Subscription**
3. Fill in:
   - **Method:** `POST`
   - **Callback URL:** `https://sarthak-singapore.vercel.app/api/ringg/webhook`
   - **Select Events:** check **Call Completed** and **All Processing Done** only
   - **Custom Headers:** leave empty (Ringg doesn't sign payloads)
4. Click **Create Subscription**

#### Testing Ringg.ai

1. On the assistant page, click **Test agent** (top-right)
2. Have a 30-second conversation
3. Hang up
4. Wait ~30 seconds (Ringg processes the transcript server-side)
5. Open dashboard → **Voice Calls** tab — the call should appear with the full transcript

#### If Ringg Doesn't Show Up on Dashboard

- Check Vercel logs: vercel.com → sarthak-singapore → Functions → `/api/ringg/webhook`
- Verify the webhook was created in Ringg (Event Subscription page should show it as active)
- Common issue: Ringg sometimes only sends `all_processing_completed` — that event is already handled by our code

---

## Environment Variables (Vercel)

All set in Vercel → sarthak-singapore → Settings → Environment Variables:

```
RINGG_AI_VOICE_AGENT=86ee188a-38cf-49fb-a2d1-e1305759e84f
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://yhwoqmhnvzpfgacfaidg.supabase.co
SUPABASE_SERVICE_KEY=eyJ... (service_role, not anon)
META_VERIFY_TOKEN=sarthak_whatsapp_2026
META_PHONE_NUMBER_ID=1010381558815985
META_ACCESS_TOKEN=EAAJScQ4VUWcBRS4...  (permanent System User token)
NEXT_PUBLIC_SUPABASE_URL=https://yhwoqmhnvzpfgacfaidg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (anon, for browser-side dashboard reads)
```

Local copy in `.env` (gitignored).

---

## Running Locally

```bash
cd /Users/amaanbarmare/Desktop/sarthak-real-estate
npm run dev    # → localhost:3000
npm run build  # production build check
```

For webhooks while developing locally, use ngrok:
```bash
ngrok http 3000
# then point Ringg.ai + Meta webhooks at the ngrok URL temporarily
```

---

## Editing the AI Persona (Priya)

The system prompt for the WhatsApp bot lives in [`lib/openai.ts`](lib/openai.ts).

To change how Priya speaks, edit the `SYSTEM_PROMPT` constant. After committing and pushing, Vercel redeploys in ~60s and the new persona is live.

Currently configured:
- Default language: Hindi (switches to English if user does)
- Project knowledge: all 6 projects (Grand Virasat, Pink City, Modern City, Oracle City, One Street, King Estate)
- Never quotes pricing — defers to site visit
- Pushes for Saturday/Sunday 11am site visits

---

## Adding More Projects

Edit [`lib/projects.ts`](lib/projects.ts) — add a new entry to the `PROJECTS` array. The Projects page and per-project stats will pick it up automatically.

---

## Common Quick Debugging

### Dashboard shows no data
- Check Supabase: dashboard → Table Editor → `calls` and `wa_messages` — are there rows?
- Check browser console for Supabase auth errors
- Check `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set in Vercel env vars

### Webhook returns 500
- Vercel → Functions → click the function → see error logs in real-time
- Usually: missing env var, Supabase RLS issue, or OpenAI rate limit

### Meta complains "Webhook verification failed"
- The verify token in Meta UI must match `META_VERIFY_TOKEN` env var exactly
- Currently: `sarthak_whatsapp_2026`

---

## Files You'll Probably Touch

| File | What it does |
|------|--------------|
| [`lib/openai.ts`](lib/openai.ts) | Priya's brain — system prompt + GPT-4.1-mini call |
| [`lib/projects.ts`](lib/projects.ts) | Project catalogue used across the dashboard |
| [`app/page.tsx`](app/page.tsx) | Overview dashboard |
| [`app/api/whatsapp/webhook/route.ts`](app/api/whatsapp/webhook/route.ts) | Inbound WhatsApp handler |
| [`app/api/ringg/webhook/route.ts`](app/api/ringg/webhook/route.ts) | Inbound Ringg call handler |

---

## Quick Wins for the Demo

If you're showing this to Sarthak's team, the most impressive flow is:

1. Send a WhatsApp message from a real phone → Priya replies → both appear on dashboard live
2. Trigger a Ringg test call → watch it land in Voice Calls tab with full transcript
3. Click around the Leads kanban → show the drawer with full call history
4. Show the Projects grid → real per-project demand counts

The dashboard auto-refreshes every 10 seconds, so as messages come in during the demo, they just appear. Looks magical.

---

## Contact (Me)

If anything breaks or you want a feature added, ping me — Amaan.

Repo is yours, env vars are yours, ship freely.
