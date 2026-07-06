# Sarthak Singapore — AI Sales Engine

AI sales engine for **Sarthak Singapore** (real estate, Mhow / Indore — project
**"Singapore Miracle"**). An ElevenLabs Conversational AI voice agent ("प्रिया")
places outbound calls over a VoBiz SIP trunk, qualifies leads in Hindi, books site
visits via Cal.com, and warm-transfers hot leads — all feeding a unified Next.js
dashboard. Built by [Oltaflock](https://oltaflock.ai).

> **Voice provider history:** Ringg.ai → DialNexa → **ElevenLabs + VoBiz** (current).
> **ElevenLabs account:** migrated 2026-07 to a new account (agent **"Sarthak Miracle"**,
> `agent_6801kwrchx5yfnha0jechj2t67pm`). See [Operations runbook](#operations-runbook).

---

## Stack

- **Frontend / API** — Next.js (App Router), deployed on **Vercel** (Hobby plan)
- **Database** — **Supabase** (Postgres + Deno Edge Functions)
- **Voice** — **ElevenLabs** Conversational AI + **VoBiz** SIP trunk
- **CRM** — **Zoho CRM** (India DC) — lead source
- **Site-visit booking** — **Cal.com** (agent tool)
- **WhatsApp** — **Interakt** (BSP) — sales/customer notifications
- **Enrichment** — OpenAI GPT-4.1-mini
- **Scheduling** — **GitHub Actions** cron (Vercel Hobby forbids sub-daily crons)

---

## How it works (end to end)

```
Zoho CRM (Project_Name contains "Miracle", Lead_Status = "Not Answer")
        │   /api/zoho/sync  (GitHub Actions, every 6h)
        ▼
call_queue  ──►  dialer engine (lib/dialer.ts)  ──►  ElevenLabs outbound call
   (per-lead     /api/voice/process               over VoBiz SIP trunk
    cadence)     GitHub Actions, every 10 min             │
        ▲                                                 │ प्रिया qualifies,
        │  no-pickup → reschedule on cadence              │ books visit / transfers
        │                                                 ▼
        │                              ┌──── call ends → ElevenLabs post-call webhook
        │                              │        supabase/functions/elevenlabs-webhook
        └──────────────────────────────┘        → calls + leads + site_visits
                                       │        → WhatsApp (Interakt) on transfer / booking
                                       └──── carrier CDR → VoBiz webhook
                                                supabase/functions/vobiz-webhook → call_cdr
        ▼
   Supabase  ──►  Dashboard (polls /api/* every 8–10s)
```

### Two voice layers, two webhooks, no overlap

| Layer        | Provider   | Edge function        | Writes                         |
|--------------|------------|----------------------|--------------------------------|
| Conversation | ElevenLabs | `elevenlabs-webhook` | `calls`, `leads`, `site_visits`|
| Telephony    | VoBiz      | `vobiz-webhook`      | `call_cdr`                     |

- **ElevenLabs** handles `post_call_transcription` (transcript, analysis, heuristic
  lead score, site-visit booking) and `call_initiation_failure` (busy / no-answer →
  missed-lead row). Dedupe on `call_id` (= ElevenLabs `conversation_id`). Signature:
  `ElevenLabs-Signature: t=…,v0=…` → `HMAC-SHA256("<t>.<rawBody>", ELEVENLABS_WEBHOOK_SECRET)`,
  30-min replay window. It also filters by `agent_id` (only our agent's calls are stored —
  the workspace webhook is shared).
- **VoBiz** carries carrier-only data: INR cost, MOS/jitter, ring/answer/hangup timing,
  SIP hangup cause. Dedupe on `call_uuid`. Signature signs URL+nonce, not the body.

---

## The outbound dialer engine

`lib/dialer.ts` — driven by `/api/voice/process` (`processTick`), called every 10 min
by a GitHub Actions cron (and by the dashboard while open). Each tick:

1. **`reconcile`** — settle `dialing` rows whose call ended (a `calls` row exists) or
   went stale (`STALE_MIN = 6`). Picked-up → `completed`; no-pickup → rescheduled on
   the cadence.
2. **`dialNext`** — fill free slots up to the concurrency cap, dialing due `queued` rows.
3. **`closeFinishedBatches`** — mark batches with no `queued`/`dialing` rows `done`.

### Calling window — 10:00–20:00 IST, all 7 days

`withinCallWindowIST()` gates dialing to **10 AM–8 PM IST** (UTC+5:30), every day. The
cron runs 24/7 but only *dials* inside the window; outside it, it still reconciles /
reschedules. No lead is ever rung at night.

### No-pickup cadence — 1, 3, 5, 7, 15, 30 days, then stop

Per-lead `retry_days = [1,3,5,7,15,30]` on the batch. A no-answer reschedules to the next
cadence day (`settleNoPickup`); after the 6th attempt (day 30) the lead is marked failed.
Distinct from the Zoho-sync cadence (every 6h) which just tops up the queue.

### Concurrency & the VoBiz 3-channel limit

- `MAX_GLOBAL_CONCURRENCY = 2` — a hard ceiling across all batches. **VoBiz allows only
  3 concurrent SIP channels**, and a warm transfer consumes a 3rd (प्रिया dials the
  salesman while the caller holds). Cap at 2 to keep one channel free for transfers.
  *(ElevenLabs now allows 20 concurrent calls — VoBiz is the bottleneck.)*
- **Post-call cooldown** (`POST_CALL_COOLDOWN_SECS = 15`, env `DIAL_COOLDOWN_SECS`) — a
  SIP channel is **not** freed the instant a call ends (teardown can lag up to ~30s on a
  bad hangup). After any call ends, the dialer waits before dialing a replacement, so we
  don't grab a channel while the old one is still tearing down and trip the 3/3 limit.
  The real fix is more VoBiz channels.
- **Connect-failure backoff** — if placing a call throws (EL/VoBiz rejected, network,
  out of credits), the row backs off `CONNECT_FAIL_BACKOFF_MIN = 30` min and does **not**
  advance the cadence or mark the lead failed. This prevents the "retry storm" (a failed
  dial re-firing every tick) that hammered leads and tripped VoBiz 3/3 during the July
  outage.

---

## Lead source — Zoho CRM sync

`/api/zoho/sync` (`lib/zoho.ts`) pulls leads where **`Project_Name` contains "Miracle"**
AND **`Lead_Status` = "Not Answer"** — i.e. Miracle leads that human callers couldn't
reach — and queues them for the AI dialer. Read-only on Zoho (no write-back).

- Idempotent: dedupes by phone (`phoneKey`, last-10-digits) against **all** of `call_queue`.
- Batch: `"Singapore Miracle — Not Answer"`, `concurrency: 2`, `ringing_timeout_secs: 30`,
  `retry_days: [1,3,5,7,15,30]`.
- Voice line auto-discovered (the number assigned to our agent in ElevenLabs); override
  with `ZOHO_SYNC_AGENT_PHONE_NUMBER_ID`.
- Zoho auth: OAuth self-client (refresh token, India DC `accounts.zoho.in` /
  `www.zohoapis.in`). Setup guide in [`ZOHO_SETUP.md`](ZOHO_SETUP.md).

> **Filter caveat:** call only `Project_Name` **contains "Miracle"** (~1k leads), NOT a
> word-search for "Singapore Miracle" (~45).

---

## Automation — GitHub Actions crons

Vercel Hobby rejects crons more frequent than daily, so schedules live in GitHub Actions
(`.github/workflows/`). Both hit gated Vercel endpoints with `Authorization: Bearer $CRON_SECRET`
(see `proxy.ts`).

| Workflow            | Schedule        | Hits                | Purpose                          |
|---------------------|-----------------|---------------------|----------------------------------|
| `dialer-tick.yml`   | every 10 min    | `/api/voice/process`| drive the queue / callbacks      |
| `zoho-sync.yml`     | every 6 hours   | `/api/zoho/sync`    | top up the queue from Zoho       |

GitHub repo secrets: `CRON_SECRET` (= Vercel value). Variables: `APP_URL`
(`https://sarthak-singapore.vercel.app`). To pause the campaign, comment out the
`schedule:` blocks (keep `workflow_dispatch`) and pause the batch.

---

## Voice agent ("प्रिया")

- Speaks **Hindi** by default (Devanagari-only for correct TTS), switches to English to
  match the caller. Qualifies end-use vs investment, NRI vs local, budget, timeline.
- **Never quotes prices** — defers to the sales team. Gives property **sizes** as ranges
  (showroom 1125–1565, shop 335–340, office 330–450 & 1080–1215, flats 1185–2323 sq ft).
- Books site visits via a **Cal.com** tool; warm-transfers hot leads to the sales team.

### ⚠️ First-message override must be ON

The agent's default first message is
`"नमस्ते, मैं प्रिया … क्या मेरी बात {{callee_name}} जी से हो रही है?"` — it **requires**
`callee_name`. The dialer (`greetingFor` in `lib/elevenlabs.ts`):

- **Named lead** → passes `callee_name` → default first message works.
- **No-name lead** → sends a name-less **first_message override** (never "Unknown जी").

For the no-name path to work, the agent must have **`first_message` override enabled**
(ElevenLabs → agent → Security → Overrides). If it's off, every no-name lead that answers
fails with *"Missing required dynamic variables: callee_name"*. The 2026-07 account was
created with it **off** — it has been turned **on**. Re-check this on any agent migration.

### Agent ID is pinned in code (not env)

`AGENT_ID` is **hardcoded** in `lib/elevenlabs.ts` (and mirrored in the webhook's agent
filter), *not* read from `ELEVENLABS_AGENT_ID`. After the 2026-07 migration, Vercel still
held the **old** agent ID in that env var, which overrode the fallback and failed every
call with "agent not found". Pinning keeps the app and webhook in lockstep. **Change the
agent here (and in the webhook) on the next migration**, not just in Vercel.

---

## WhatsApp notifications (Interakt)

Sent via Interakt (`POST https://api.interakt.ai/v1/public/message/`,
`Authorization: Basic <INTERAKT_API_KEY>`). All non-fatal — a WhatsApp failure never
breaks call recording. Idempotent per call via `analysis` flags.

| Trigger                         | Template                        | Recipient(s)              | Body vars                                   |
|---------------------------------|---------------------------------|---------------------------|---------------------------------------------|
| Warm **transfer** to a human    | `lead_transfer_alert`           | sales (`WHATSAPP_HANDOFF_MIRACLE`) | name, phone, project, reason, budget, timeline |
| **Site visit booked** (Cal.com) | `ai_ssg_site_visit_booked`      | sales                     | lead, phone, project, when, status          |
| **Site visit booked** (Cal.com) | `aiclient_ssg_sitevisit_booked` | the **client** (lead's #) | name, project, when, team member, contact   |

Site-visit member name/contact shown to the client come from `SITEVISIT_SALES_NAME` /
`SITEVISIT_SALES_CONTACT` (fall back to the handoff number).

---

## Site visits (Cal.com)

A visit counts as **booked only when the Cal.com booking tool returns a real `uid`** —
never the agent's `site_visit_booked` guess. On a confirmed booking the webhook writes a
`site_visits` row with status **`confirmed`** (a real appointment, not "pending") and
fires the two WhatsApp templates above. Statuses: `pending` → `confirmed` → `done` /
`cancelled`, editable on the Site Visits page.

---

## Dashboard

Pages under `app/(dashboard)/`: **Overview**, **Voice Calls**, **Dialer**, **Leads**,
**Site Visits**. Reads go through gated `/api/*` routes (service key, behind the password
proxy) — the browser never holds the Supabase key. `DASHBOARD_SINCE` (default
`2026-06-04`) hides legacy Ringg/DialNexa test data.

### Voice Minutes counter

`/api/usage/minutes` + a card on Overview. ElevenLabs' API exposes only TTS **character
credits**, never ConvAI **minutes**, so we compute usage ourselves:

- **Used** = `sum(calls.duration_seconds)/60` since a fixed billing start
  (`MINUTES_SINCE`, default **2026-07-04 06:00 IST**).
- **Total** = plan allowance (`ELEVENLABS_PLAN_MINUTES`, default **1200**; the Pro plan
  actually includes **1,238** min).
- Usage bar goes amber >70%, red >90% — an early warning before running out (the July
  outage cause).

> **Billing note:** ElevenLabs bills Conversational AI by **actual call duration**
> (connection seconds, with a 95% discount for silence >10s) — **not** rounded up per
> minute. So a 10s call ≈ 10s, and summing real durations matches what EL charges.

---

## Supabase tables

| Table         | One row per            | Key columns |
|---------------|------------------------|-------------|
| `calls`       | voice call             | `call_id` (conversation_id), `lead_name`, `lead_phone`, `project`, `duration_seconds`, `outcome`, `lead_score`, `transcript` (jsonb), `analysis` (jsonb), `summary`, `created_at` |
| `leads`       | contact (by phone)     | `phone` (canonical +E.164), `name`, `project`, `status` (new/qualified/booked…), `lead_score`, `buyer_type`, `timeline`, `budget` |
| `site_visits` | booked visit           | `call_id`, `lead_phone`, `status`, `scheduled_for`, `notes` |
| `call_cdr`    | VoBiz carrier event    | `call_uuid`, cost, MOS/jitter, SIP cause |
| `call_batches`| dialer campaign        | `label`, `status` (running/paused/done/canceled), `agent_phone_number_id`, `concurrency`, `ringing_timeout_secs`, `retry_days`, `max_attempts` |
| `call_queue`  | queued/attempted lead  | `batch_id`, `lead_name`, `lead_phone`, `status` (queued/dialing/completed/failed), `attempts`, `next_attempt_at`, `conversation_id`, `dynamic_vars` |

Schema in `supabase/schema.sql`; migrations in `supabase/migrations/`.

---

## Environment variables

Live in **three** places — set each where it's read:

**Vercel (Next.js app):**
```env
ELEVENLABS_API_KEY=            # outbound calls (new account key)
# ELEVENLABS_AGENT_ID          # IGNORED — agent is pinned in code (see above)
OPENAI_API_KEY=                # gpt-4.1-mini (enrichment)
SUPABASE_URL= / SUPABASE_SERVICE_KEY=
ZOHO_CLIENT_ID= / ZOHO_CLIENT_SECRET= / ZOHO_REFRESH_TOKEN= / ZOHO_API_DOMAIN=
CRON_SECRET=                   # bearer for /api/voice/process & /api/zoho/sync
APP_URL=                       # https://sarthak-singapore.vercel.app
ELEVENLABS_PLAN_MINUTES=       # optional — plan minutes (default 1200)
MINUTES_SINCE=                 # optional — billing start (default 2026-07-04T06:00:00+05:30)
DIAL_COOLDOWN_SECS=            # optional — post-call cooldown (default 15)
ZOHO_SYNC_AGENT_PHONE_NUMBER_ID=  # optional — force a voice line
```

**Supabase edge-function secrets:**
```env
SUPABASE_URL= / SUPABASE_SERVICE_ROLE_KEY=
ELEVENLABS_WEBHOOK_SECRET=     # wsec_… — per-account; verifies post-call webhook
INTERAKT_API_KEY=              # WhatsApp BSP (Basic auth)
WHATSAPP_HANDOFF_MIRACLE=      # sales WhatsApp # (e.g. 917471185956)
SITEVISIT_SALES_NAME= / SITEVISIT_SALES_CONTACT=   # optional — shown to the client
VOBIZ_AUTH_TOKEN= / VOBIZ_CALLBACK_URL=
```

**GitHub Actions:** secret `CRON_SECRET`, variable `APP_URL`.

---

## Key files

| File | Purpose |
|------|---------|
| `app/(dashboard)/page.tsx` | Overview dashboard + Voice Minutes card |
| `app/(dashboard)/dialer/page.tsx` | Dialer: keypad, CSV/XLSX bulk import, live queue |
| `app/(dashboard)/site-visits/page.tsx` | Site visits table |
| `lib/dialer.ts` | Dialer engine (reconcile / dialNext / cadence / cooldown) |
| `lib/elevenlabs.ts` | ElevenLabs client, `AGENT_ID`, `greetingFor`, subscription |
| `lib/zoho.ts` | Zoho CRM client + Miracle/Not-Answer filter |
| `app/api/voice/process/route.ts` | Dialer tick endpoint (cron target) |
| `app/api/zoho/sync/route.ts` | Zoho → `call_queue` sync (cron target) |
| `app/api/usage/minutes/route.ts` | Voice Minutes counter |
| `app/api/calls/route.ts` | Gated calls reader (latest 500, slim) |
| `supabase/functions/elevenlabs-webhook/index.ts` | Post-call → calls/leads/site_visits + WhatsApp |
| `supabase/functions/vobiz-webhook/index.ts` | SIP callbacks → `call_cdr` |
| `.github/workflows/dialer-tick.yml` / `zoho-sync.yml` | Cron schedulers |
| `proxy.ts` | Password gate + `CRON_SECRET` bypass for cron endpoints |

---

## Operations runbook

**Pause the campaign** — comment out `schedule:` in both workflow files (keep
`workflow_dispatch`) **and** set the batch `status = paused`. The edge functions are
passive receivers; they place no calls and need no stopping.

**Resume / migrate to a new ElevenLabs account:**
1. Set the new `ELEVENLABS_API_KEY` in **Vercel**; set the new `ELEVENLABS_WEBHOOK_SECRET`
   (`wsec_…`, per-account) as a **Supabase** secret.
2. Update the agent ID **in code** — `AGENT_ID` in `lib/elevenlabs.ts` and the webhook's
   `SARTHAK_AGENT_ID` — then push (it's pinned, not env-driven).
3. **Import the number** into the new account (SIP trunk) and **assign it to the agent**;
   update the batch's `agent_phone_number_id` to the new `phnum_…`.
4. **Enable `first_message` override** on the new agent (else no-name leads fail).
5. Un-comment the two cron `schedule:` blocks; un-pause the batch (`status = running`).
6. Verify: trigger one tick (`curl -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/voice/process`)
   and confirm a non-null `conversation_id`.

**Known issues & fixes (all resolved in code — see git history):**
- *Retry storm / VoBiz 3/3* → connect-failure backoff + post-call cooldown.
- *"agent not found"* → agent ID pinned in code (stale Vercel env).
- *"Missing callee_name"* on no-name leads → enable first_message override.
- *Out of credits* → calls drop ~4s; watch the Voice Minutes card.

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npx tsc --noEmit # typecheck
```

Edge functions deploy via the Supabase CLI:
```bash
supabase functions deploy elevenlabs-webhook --no-verify-jwt --project-ref yhwoqmhnvzpfgacfaidg
```

App auto-deploys to Vercel on push to `main`.
