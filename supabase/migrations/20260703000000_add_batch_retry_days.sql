-- Multi-day no-pickup cadence.
--
-- When call_batches.retry_days is set (e.g. [1,3,5,7,15,30]), a lead that
-- doesn't pick up is called back on those day-numbers counted from the first
-- attempt — day 1 (first call), day 3, day 5, day 7, day 15, day 30 — then
-- given up. This overrides the flat retry_interval_minutes for that batch.
-- Null = keep the same-day retry_interval_minutes behavior (e.g. call back in 2h).
--
-- The dialer reads retry_days in settleNoPickup: attempt N is scheduled
-- retry_days[N] - retry_days[N-1] days after attempt N-1, and once N reaches
-- retry_days.length the lead is marked failed ("stop calling").

alter table call_batches
  add column if not exists retry_days jsonb;
