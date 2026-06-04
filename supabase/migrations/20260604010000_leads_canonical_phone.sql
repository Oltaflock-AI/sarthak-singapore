-- Guarantee one lead row per phone, forever.
--
-- Root cause of duplicates: the same contact was written as both "+9198…"
-- (webhook) and "9198…" (enrich route). leads.phone is UNIQUE, but those are
-- distinct strings so both survived. Fix in two parts: (1) merge existing
-- duplicate pairs, (2) a BEFORE trigger that normalizes every phone to +E.164
-- on insert/update, so the unique index always collapses them — regardless of
-- which code path writes.

-- ── 1a) Merge each legacy (unprefixed) row into its canonical "+" twin ──
update leads c set
  name        = coalesce(c.name, l.name),
  project     = coalesce(c.project, l.project),
  buyer_type  = coalesce(c.buyer_type, l.buyer_type),
  residency   = coalesce(c.residency, l.residency),
  timeline    = coalesce(c.timeline, l.timeline),
  budget      = coalesce(c.budget, l.budget),
  lead_score  = greatest(coalesce(c.lead_score, 0), coalesce(l.lead_score, 0)),
  score_label = coalesce(nullif(c.score_label, ''), l.score_label),
  notes       = coalesce(c.notes, l.notes),
  status      = case when coalesce(c.status, 'new') = 'new'
                     then coalesce(l.status, c.status) else c.status end
from leads l
where l.phone !~ '^\+'
  and c.phone = '+' || l.phone;

-- ── 1b) Drop legacy rows that now have a canonical twin ──
delete from leads l
where l.phone !~ '^\+'
  and exists (select 1 from leads c where c.phone = '+' || l.phone);

-- ── 1c) Canonicalize any remaining digit-only rows (no twin) ──
update leads
set phone = '+' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone !~ '^\+' and phone ~ '[0-9]';

-- ── 2) Trigger: normalize phone to +E.164 on every write ──
create or replace function leads_canonical_phone() returns trigger as $$
begin
  if new.phone is not null and new.phone <> '' then
    new.phone := '+' || regexp_replace(new.phone, '[^0-9]', '', 'g');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leads_canonical_phone on leads;
create trigger trg_leads_canonical_phone
  before insert or update on leads
  for each row execute function leads_canonical_phone();

-- ── 3) Allow nameless leads (missed/no-answer calls have no name yet) ──
alter table leads alter column name drop not null;
