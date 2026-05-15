-- Add unique constraint on call_id for upsert-on-conflict deduplication
alter table calls add column if not exists call_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calls_call_id_key'
  ) then
    alter table calls add constraint calls_call_id_key unique (call_id);
  end if;
end $$;
