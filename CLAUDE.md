# CLAUDE.md — Sarthak Singapore AI Sales Engine

## Project Overview

This is the AI Sales Engine for Sarthak Singapore (real estate, Mhow/Indore). It combines a voice agent (Ringg.ai) and a WhatsApp chatbot (Meta Cloud API + GPT-4.1-mini) into a unified dashboard. Built by Oltaflock.

**Stack**: Next.js (App Router) · Supabase · Ringg.ai · Meta Cloud API · OpenAI GPT-4.1-mini · Vercel

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
  Ringg.ai places outbound call
        │
  call completes → webhook → /api/ringg/webhook
        │
        ▼
   Supabase (calls table)
        │
        ▼
   Dashboard polls every 10s

WhatsApp message received
        │
        ▼
  /api/whatsapp/webhook
        │
  GPT-4.1-mini generates reply (Priya persona, Hindi/English)
        │
  Meta Graph API sends reply
        │
        ▼
  Supabase (wa_messages table)
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/page.tsx` | Dashboard (ported from sarthak-dashboard.html) |
| `app/api/ringg/webhook/route.ts` | Receives Ringg.ai call events |
| `app/api/whatsapp/webhook/route.ts` | WhatsApp verify + message handler |
| `lib/supabase.ts` | Supabase server client |
| `lib/openai.ts` | GPT-4.1-mini client + Priya prompt |
| `supabase/schema.sql` | Tables: calls, wa_messages |

---

## Environment Variables

```env
RINGG_AI_VOICE_AGENT=           # Ringg.ai assistant/agent UUID
OPENAI_API_KEY=                 # OpenAI — use gpt-4.1-mini
SUPABASE_URL=                   # Supabase project URL
SUPABASE_SERVICE_KEY=           # Supabase service role key (server-side only)
META_VERIFY_TOKEN=              # Arbitrary string — must match Meta webhook config
META_PHONE_NUMBER_ID=           # From Meta Developer → WhatsApp → API Setup
META_ACCESS_TOKEN=              # Permanent System User token (never expires)
```

---

## Supabase Tables

```sql
-- calls: one row per Ringg.ai call
calls (
  id, lead_name, lead_phone, project, source,
  lead_score, score_label, duration_seconds,
  outcome, transcript (jsonb), created_at
)

-- wa_messages: one row per WhatsApp conversation turn
wa_messages (
  id, from_number, name, text_in,
  text_out, wa_id, created_at
)
```

---

## Ringg.ai Integration Notes

- No webhook secret — Ringg.ai does not sign webhook payloads
- Store `RINGG_AI_VOICE_AGENT` (agent UUID) for triggering outbound calls
- Webhook fires `call_completed` with transcript, score, outcome, duration
- Deduplicate on `call_id` to avoid double-writes on retries

## WhatsApp / Meta Notes

- Webhook verification: `GET /api/whatsapp/webhook` — match `hub.verify_token` against `META_VERIFY_TOKEN`
- Incoming messages: `POST /api/whatsapp/webhook` — always return 200 immediately, process async
- Send replies via `POST https://graph.facebook.com/v21.0/{META_PHONE_NUMBER_ID}/messages`
- WhatsApp Business Account ID: `2261117857719079` (for template management if needed later)
- Test phone number: `+1 814 404 5578` (Meta sandbox number)

## AI Persona

The WhatsApp bot responds as **Priya**, Sarthak Singapore's AI sales assistant. She:
- Speaks Hindi by default, switches to English if the user does
- Qualifies leads: end-use vs investment, NRI vs local, budget, timeline
- Books site visits, sends brochure links, warm-transfers hot leads
- Never makes up pricing — defers to the sales team for exact rates
