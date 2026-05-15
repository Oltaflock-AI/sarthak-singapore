-- Run once in Supabase SQL editor.

create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null,
  name            text,
  project         text,
  buyer_type      text,                       -- end_use | investment
  residency       text,                       -- local | nri
  timeline        text,                       -- "Dec 2026", "3 months", etc.
  budget          text,                       -- free text
  source          text default 'whatsapp',    -- whatsapp | voice | web
  lead_score      integer default 50,
  score_label     text default 'WARM',        -- HOT | WARM | COLD
  status          text default 'new',         -- new | qualified | booked | converted | lost
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create unique index if not exists leads_phone_uniq on leads(phone);

alter table leads enable row level security;
drop policy if exists "Public read leads" on leads;
create policy "Public read leads" on leads for select using (true);

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

create table if not exists site_visits (
  id                  uuid primary key default gen_random_uuid(),
  lead_phone          text not null,
  lead_name           text,
  project             text,
  scheduled_for       timestamptz,
  scheduled_for_text  text,                   -- "Saturday 11am" until normalized
  status              text default 'pending', -- pending | confirmed | done | cancelled
  notes               text,
  created_at          timestamptz default now()
);
create index if not exists site_visits_phone_idx on site_visits(lead_phone);

alter table site_visits enable row level security;
drop policy if exists "Public read site_visits" on site_visits;
create policy "Public read site_visits" on site_visits for select using (true);
