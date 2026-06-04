-- Let the post-call webhook write one site_visits row per booked call,
-- idempotently (ElevenLabs retries post-call webhooks).
alter table site_visits add column if not exists call_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_visits_call_id_key'
  ) then
    alter table site_visits add constraint site_visits_call_id_key unique (call_id);
  end if;
end $$;
