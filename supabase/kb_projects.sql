-- Run this once in the Supabase SQL editor.

create table if not exists kb_projects (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  type            text not null,
  configurations  text,
  location        text,
  possession      text,
  hero            text,
  pricing_notes   text,
  usps            text,
  amenities       text,
  brochure_url    text,
  rera_number     text,
  custom_notes    text,
  is_active       boolean default true not null,
  display_order   integer default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table kb_projects enable row level security;

drop policy if exists "Public read kb_projects" on kb_projects;
create policy "Public read kb_projects" on kb_projects for select using (true);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists kb_projects_updated_at on kb_projects;
create trigger kb_projects_updated_at before update on kb_projects
  for each row execute function set_updated_at();
