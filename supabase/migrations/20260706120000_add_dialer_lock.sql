-- Serialize the outbound dialer so concurrent ticks can't over-dial.
--
-- The dashboard polls /api/voice/process every few seconds AND a GitHub Actions
-- cron hits it every 10 min. Without a lock, two ticks each read the in-flight
-- call count, both see a free slot under MAX_GLOBAL_CONCURRENCY, and both dial —
-- overshooting the cap and tripping VoBiz's 3-concurrent-channel limit (3/3).
--
-- dialNext() acquires this single-row lock before dialing. Acquire is one atomic
-- UPDATE (…WHERE id=1 AND locked_at < now()-ttl): Postgres row-locks serialize
-- concurrent updaters, so only the winner's UPDATE matches and returns a row;
-- the rest see a fresh locked_at and get nothing, so they skip dialing.
create table if not exists dialer_lock (
  id smallint primary key default 1,
  locked_at timestamptz not null default 'epoch',
  constraint dialer_lock_singleton check (id = 1)
);

insert into dialer_lock (id, locked_at) values (1, 'epoch')
  on conflict (id) do nothing;
