# CLAUDE.md — Sarthak Singapore AI Sales Engine

## Project Overview

This is the AI Sales Engine for Sarthak Singapore (real estate, Mhow/Indore). A voice agent (ElevenLabs Conversational AI over a VoBiz SIP trunk) feeds a unified dashboard. Built by Oltaflock.

**Stack**: Next.js (App Router) · Supabase · ElevenLabs Conversational AI · VoBiz SIP trunk · OpenAI GPT-4.1-mini (enrichment) · Vercel

> Voice provider history: Ringg.ai → DialNexa → **ElevenLabs + VoBiz** (current). All prior webhooks removed.

---

## Working Rules

### 1. The 95% Confidence Rule
If the direction is clearly right, keep moving — don't stall. Stop and reassess only when there is genuine ambiguity or a real blocker. Hesitation on things that are almost certainly correct wastes time and breaks flow. Momentum matters.

### 2. Plan → Build → Test, Then Move On
Every task follows three steps in order: lay out exactly what you're going to do, write the code, then confirm it actually works. Don't call a task done until it has been verified. Once it passes, close it out and move to the next one — don't revisit completed work without a reason.

---

## Architecture

```
Lead enquiry (Meta/Google ad)
        │
        ▼
  ElevenLabs agent places outbound call over VoBiz SIP trunk
        │
        ├─ conversation ends → ElevenLabs post-call webhook
        │     → supabase/functions/elevenlabs-webhook  → calls + leads
        │
        └─ carrier hangup/CDR → VoBiz callback
              → supabase/functions/vobiz-webhook       → call_cdr
        │
        ▼
   Supabase (calls, leads, call_cdr)
        │
        ▼
   Dashboard polls every 10s
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/page.tsx` | Dashboard (ported from sarthak-dashboard.html) |
| `supabase/functions/elevenlabs-webhook/index.ts` | ElevenLabs post-call → `calls` + `leads` |
| `supabase/functions/vobiz-webhook/index.ts` | VoBiz SIP callbacks → `call_cdr` |
| `lib/supabase.ts` | Supabase server client |
| `lib/openai.ts` | GPT-4.1-mini client (lead enrichment) |
| `supabase/schema.sql` | Tables: calls, leads, call_cdr |

---

## Environment Variables

```env
ELEVENLABS_API_KEY=             # ElevenLabs API key (outbound calls / SDK)
ELEVENLABS_AGENT_ID=            # ElevenLabs Conversational AI agent ID
ELEVENLABS_WEBHOOK_SECRET=      # wsec_… — HMAC secret for post-call webhook (set on edge fn)
VOBIZ_AUTH_TOKEN=               # VoBiz account auth token — HMAC key for callback verify
VOBIZ_CALLBACK_URL=             # Exact public vobiz-webhook URL (for signature base, optional)
OPENAI_API_KEY=                 # OpenAI — use gpt-4.1-mini (deep enrichment)
SUPABASE_URL=                   # Supabase project URL
SUPABASE_SERVICE_KEY=           # Supabase service role key (server-side only)
```

---

## Supabase Tables

```sql
-- calls: one row per voice call
calls (
  id, lead_name, lead_phone, project, source,
  lead_score, score_label, duration_seconds,
  outcome, transcript (jsonb), created_at
)
```

---

## Voice Integration Notes (ElevenLabs + VoBiz)

**Two layers, two webhooks, no overlap:**

- **ElevenLabs** = conversation layer → `calls` + `leads`. Edge fn `elevenlabs-webhook`.
  - Signature: `elevenlabs-signature: t=<unix>,v0=<hex>` → `HMAC-SHA256("<t>.<rawBody>", ELEVENLABS_WEBHOOK_SECRET)`, 30-min replay window.
  - Handles `post_call_transcription` (answered: transcript + analysis + heuristic score) and `call_initiation_failure` (busy/no-answer → missed-lead row, `outcome` = failure reason).
  - `call_id` = ElevenLabs `conversation_id`. Dedupe via `onConflict: call_id`.
  - Lead phone: outbound = `metadata.phone_call.external_number`/`to_number`; inbound = `from_number`. Name/project/timeline/budget pulled from `analysis.data_collection_results` (agent-configured) — key names are best-effort.
- **VoBiz** = telephony layer → `call_cdr` (separate table). Edge fn `vobiz-webhook`.
  - Signature: `X-Vobiz-Signature-V3` = `base64(HMAC-SHA256(VOBIZ_AUTH_TOKEN, baseURL + "." + nonce))`, nonce in `X-Vobiz-Signature-V3-Nonce`. Signs URL+nonce, NOT body. V2 = same without the `.`.
  - Events: `Ring` / `StartApp` / `Hangup` / `recording.completed`. Dedupe via `onConflict: call_uuid` (VoBiz `CallUUID`).
  - Carrier-only data: INR cost, MOS/jitter, ring/answer/hangup timing, SIP hangup cause. Rich fields backfillable from VoBiz CDR REST API (`X-Auth-ID`/`X-Auth-Token`).
  - Join to `calls` on phone + time when a unified view is needed.

**SIP wiring** (no code): import VoBiz number in ElevenLabs (Import from SIP Trunk, transport TCP, `<domain>.sip.vobiz.ai`). Inbound: point VoBiz trunk at `sip.rtc.elevenlabs.io:5060` (TCP), attach number to agent.

## Voice Agent Persona

The ElevenLabs voice agent is Sarthak Singapore's AI sales assistant. It:
- Speaks Hindi by default, switches to English if the caller does
- Qualifies leads: end-use vs investment, NRI vs local, budget, timeline
- Books site visits, warm-transfers hot leads
- Never makes up pricing — defers to the sales team for exact rates
