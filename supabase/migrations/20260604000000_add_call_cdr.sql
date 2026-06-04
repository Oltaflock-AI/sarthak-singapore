-- VoBiz telephony-layer Call Detail Records.
-- Carrier truth ElevenLabs can't see: billing (INR), voice quality (MOS/jitter),
-- true ring/answer/hangup timing, SIP hangup cause. Kept SEPARATE from `calls`
-- (which is the ElevenLabs conversation layer) — join on phone + time when needed.

create table if not exists call_cdr (
  id                bigserial primary key,
  call_uuid         text unique,             -- VoBiz CallUUID / uuid (dedupe key)
  event             text,                    -- Ring | StartApp | Hangup | recording.completed
  direction         text,                    -- inbound | outbound
  from_number       text,
  to_number         text,
  status            text,                    -- completed | no-answer | busy | failed
  duration_seconds  integer,                 -- total call seconds
  billsec           integer,                 -- billed (answered) seconds
  ring_time         integer,
  start_time        timestamptz,
  answer_time       timestamptz,
  end_time          timestamptz,
  hangup_cause      text,                    -- e.g. NORMAL_CLEARING
  hangup_cause_name text,
  hangup_source     text,                    -- Caller | Callee
  cost              numeric,
  currency          text,
  mos               numeric,                 -- mean opinion score (voice quality)
  jitter            numeric,
  packet_loss       numeric,
  sip_call_id       text,
  recording_url     text,
  raw               jsonb,                   -- full callback/CDR payload
  created_at        timestamptz default now()
);

create index if not exists call_cdr_to_number_idx   on call_cdr (to_number);
create index if not exists call_cdr_from_number_idx on call_cdr (from_number);
create index if not exists call_cdr_start_time_idx  on call_cdr (start_time desc);

alter table call_cdr enable row level security;
create policy "Public read call_cdr" on call_cdr for select using (true);
-- Service role (edge function) bypasses RLS for writes.
