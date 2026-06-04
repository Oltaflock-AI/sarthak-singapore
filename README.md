# Sarthak Singapore — AI Sales Engine

AI sales engine for **Sarthak Singapore** (real estate, Mhow/Indore). A voice agent
(ElevenLabs Conversational AI over a VoBiz SIP trunk) and a WhatsApp assistant feed a
unified Next.js dashboard. Built by [Oltaflock](https://oltaflock.ai).

## Stack

- **Frontend / API**: Next.js (App Router), deployed on Vercel
- **Database**: Supabase (Postgres + Edge Functions)
- **Voice**: ElevenLabs Conversational AI + VoBiz SIP trunk
- **Messaging**: WhatsApp via Meta Graph API
- **Enrichment**: OpenAI GPT-4.1-mini

> Voice provider history: Ringg.ai → DialNexa → **ElevenLabs + VoBiz** (current).

## High-Level Architecture

```
Lead enquiry (Meta / Google ad)
        │
        ▼
  ElevenLabs agent places outbound call over VoBiz SIP trunk
        │
        ├─ conversation ends → ElevenLabs post-call webhook
        │     → supabase/functions/elevenlabs-webhook → calls + leads
        │
        └─ carrier hangup / CDR → VoBiz callback
              → supabase/functions/vobiz-webhook      → call_cdr
        │
        ▼
   Supabase (calls, leads, call_cdr)
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

### Two voice layers, two webhooks, no overlap

| Layer | Provider | Webhook | Writes |
|-------|----------|---------|--------|
| Conversation | ElevenLabs | `elevenlabs-webhook` | `calls` + `leads` |
| Telephony | VoBiz | `vobiz-webhook` | `call_cdr` |

- **ElevenLabs** handles `post_call_transcription` (transcript, analysis, heuristic
  lead score) and `call_initiation_failure` (busy/no-answer → missed-lead row).
  Dedupe on `call_id` (= ElevenLabs `conversation_id`).
- **VoBiz** carries carrier-only data: INR cost, MOS/jitter, ring/answer/hangup
  timing, SIP hangup cause. Dedupe on `call_uuid`. Join to `calls` on phone + time.

### Outbound dialer

The dashboard includes an iPhone-style keypad (`app/dialer/`) for single test calls
placed through the ElevenLabs SIP trunk. Bulk calling will arrive via Zoho CRM.

## Key Files

| File | Purpose |
|------|---------|
| `app/page.tsx` | Dashboard |
| `app/dialer/page.tsx` | Outbound dialer (single calls) |
| `app/calls/[id]/page.tsx` | Call detail + recording player |
| `app/api/recording/` | Server-side ElevenLabs audio proxy |
| `supabase/functions/elevenlabs-webhook/index.ts` | Post-call → `calls` + `leads` |
| `supabase/functions/vobiz-webhook/index.ts` | SIP callbacks → `call_cdr` |
| `lib/supabase.ts` | Supabase server client |
| `lib/openai.ts` | GPT-4.1-mini client + Priya prompt |
| `supabase/schema.sql` | Table definitions |

## Environment Variables

```env
ELEVENLABS_API_KEY=          # ElevenLabs API key (outbound calls / SDK)
ELEVENLABS_AGENT_ID=         # Conversational AI agent ID
ELEVENLABS_WEBHOOK_SECRET=   # wsec_… HMAC secret for post-call webhook
VOBIZ_AUTH_TOKEN=            # VoBiz auth token — HMAC key for callback verify
VOBIZ_CALLBACK_URL=          # Public vobiz-webhook URL (signature base, optional)
OPENAI_API_KEY=              # OpenAI — gpt-4.1-mini (enrichment)
SUPABASE_URL=                # Supabase project URL
SUPABASE_SERVICE_KEY=        # Service role key (server-side only)
META_VERIFY_TOKEN=           # Must match Meta webhook config
META_PHONE_NUMBER_ID=        # Meta Developer → WhatsApp → API Setup
META_ACCESS_TOKEN=           # Permanent System User token
```

## AI Persona

The WhatsApp bot responds as **Priya**, Sarthak Singapore's AI sales assistant. She
speaks Hindi by default (switches to English to match the user), qualifies leads
(end-use vs investment, NRI vs local, budget, timeline), books site visits, sends
brochure links, and never makes up pricing — exact rates defer to the sales team.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Deployed on [Vercel](https://vercel.com); Supabase Edge Functions deployed via the
Supabase CLI.
