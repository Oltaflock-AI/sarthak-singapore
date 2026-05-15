-- Migrate existing leads table to support WhatsApp + voice unified schema.
-- Run once in Supabase SQL editor.

-- 1) Add columns expected by webhook code (idempotent)
alter table leads add column if not exists lead_score   integer default 50;
alter table leads add column if not exists score_label  text    default 'WARM';
alter table leads add column if not exists buyer_type   text;
alter table leads add column if not exists residency    text;
alter table leads add column if not exists timeline     text;
alter table leads add column if not exists budget       text;
alter table leads add column if not exists notes        text;

-- 2) Backfill from old voice-agent columns if present
update leads set lead_score = score        where lead_score is null and score        is not null;
update leads set score_label = upper(tag)  where (score_label is null or score_label = 'WARM') and tag is not null;

-- 3) Ensure unique index on phone (already from dedupe step, but idempotent)
create unique index if not exists leads_phone_uniq on leads(phone);

-- 4) Show final state
select id, name, phone, project, status, lead_score, score_label, source from leads order by updated_at desc;
