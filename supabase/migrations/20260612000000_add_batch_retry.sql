-- Batch calling v2: no-pickup retries + per-batch ring timeout.
--
-- A row whose call ends busy / no-answer is re-queued with
-- next_attempt_at = now() + retry_interval_minutes (default 120 = 2 hours)
-- until attempts reaches max_attempts. The dialer only picks queued rows whose
-- next_attempt_at is null or in the past, so a Vercel cron hitting
-- /api/voice/process keeps callbacks firing even with the dashboard closed.

alter table call_batches
  add column if not exists ringing_timeout_secs   int not null default 60,   -- ElevenLabs telephony_call_config.ringing_timeout_secs
  add column if not exists retry_interval_minutes int not null default 120,  -- callback delay after busy/no-answer
  add column if not exists max_attempts           int not null default 1;    -- per-lead dial attempts (1 = no retry)

alter table call_queue
  add column if not exists next_attempt_at timestamptz;  -- null = dial whenever a slot frees up

-- the dialer's eligibility scan: queued rows that are due
create index if not exists call_queue_due_idx
  on call_queue (status, next_attempt_at);
