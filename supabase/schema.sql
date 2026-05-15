-- Run this in your Supabase SQL editor

create table if not exists calls (
  id              uuid primary key default gen_random_uuid(),
  call_id         text unique,               -- Ringg.ai call ID for deduplication
  lead_name       text,
  lead_phone      text,
  project         text,
  source          text,
  lead_score      integer,
  score_label     text,                      -- HOT / WARM / COLD
  duration_seconds integer,
  outcome         text,
  transcript      jsonb default '[]',
  created_at      timestamptz default now()
);

create table if not exists wa_messages (
  id              uuid primary key default gen_random_uuid(),
  wa_id           text,                      -- WhatsApp message ID
  from_number     text,
  name            text,
  text_in         text,
  text_out        text,
  created_at      timestamptz default now()
);

-- Allow the dashboard to read both tables with anon key
alter table calls enable row level security;
alter table wa_messages enable row level security;

create policy "Public read calls" on calls for select using (true);
create policy "Public read wa_messages" on wa_messages for select using (true);

-- Service role (used by API routes) bypasses RLS automatically
