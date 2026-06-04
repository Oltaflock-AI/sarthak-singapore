-- Outbound dialer: batches + per-lead call queue.
-- A "batch" groups a bulk campaign (single calls get their own one-row batch).
-- The dialer dials sequentially (concurrency 1 by default); the elevenlabs-webhook
-- writes a `calls` row keyed by call_id = conversation_id when a call ends, which
-- is how the processor knows a dialing row finished.

create extension if not exists "pgcrypto";

create table if not exists call_batches (
  id            uuid primary key default gen_random_uuid(),
  label         text,
  status        text not null default 'running',   -- running | paused | done | canceled
  agent_phone_number_id text,
  concurrency   int  not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists call_queue (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid references call_batches(id) on delete cascade,
  lead_name     text,
  lead_phone    text not null,
  project       text,
  dynamic_vars  jsonb not null default '{}'::jsonb,
  status        text not null default 'queued',     -- queued | dialing | completed | failed | canceled
  outcome       text,                               -- mirrored from calls row when known
  conversation_id text,                             -- ElevenLabs conversation_id (= calls.call_id)
  sip_call_id   text,
  attempts      int  not null default 0,
  max_attempts  int  not null default 1,
  last_error    text,
  created_at    timestamptz not null default now(),
  dialed_at     timestamptz,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists call_queue_batch_idx  on call_queue (batch_id);
create index if not exists call_queue_status_idx on call_queue (status);
create index if not exists call_queue_conv_idx   on call_queue (conversation_id);

-- keep updated_at fresh
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists call_queue_touch on call_queue;
create trigger call_queue_touch  before update on call_queue
  for each row execute function touch_updated_at();

drop trigger if exists call_batches_touch on call_batches;
create trigger call_batches_touch before update on call_batches
  for each row execute function touch_updated_at();
