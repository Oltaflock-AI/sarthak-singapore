-- Run this in Supabase SQL editor BEFORE re-running leads_and_visits.sql.
-- Keeps the most-recently-updated row per phone, deletes older dupes,
-- then creates the unique index + trigger + policies.

-- 1) Delete older duplicates, keep newest by updated_at (then created_at, then id)
delete from leads l
using leads l2
where l.phone = l2.phone
  and (
    l.updated_at < l2.updated_at
    or (l.updated_at = l2.updated_at and l.created_at < l2.created_at)
    or (l.updated_at = l2.updated_at and l.created_at = l2.created_at and l.id < l2.id)
  );

-- 2) Now create the unique index
create unique index if not exists leads_phone_uniq on leads(phone);

-- 3) Re-apply the trigger + policy (idempotent)
alter table leads enable row level security;
drop policy if exists "Public read leads" on leads;
create policy "Public read leads" on leads for select using (true);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- 4) site_visits (re-runnable)
create table if not exists site_visits (
  id                  uuid primary key default gen_random_uuid(),
  lead_phone          text not null,
  lead_name           text,
  project             text,
  scheduled_for       timestamptz,
  scheduled_for_text  text,
  status              text default 'pending',
  notes               text,
  created_at          timestamptz default now()
);
create index if not exists site_visits_phone_idx on site_visits(lead_phone);
alter table site_visits enable row level security;
drop policy if exists "Public read site_visits" on site_visits;
create policy "Public read site_visits" on site_visits for select using (true);

-- Verify
select 'leads' as t, count(*) as rows, count(distinct phone) as unique_phones from leads
union all
select 'site_visits', count(*), count(distinct lead_phone) from site_visits;
