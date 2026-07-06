-- Reliable dialer engine via pg_cron + pg_net (replaces the flaky GitHub Actions
-- schedule). Every minute, Postgres calls the Vercel dialer-tick endpoint, which
-- reconciles finished calls and dials the next queued lead (concurrency-aware).
-- The dialer_lock table (see 20260706120000) serializes concurrent ticks, so
-- firing frequently can never over-dial or trip VoBiz's 3-channel limit.
--
-- Why not GitHub Actions: GitHub's scheduler silently stopped firing this repo's
-- cron after a pause/resume and, even when healthy, only fired ~hourly. pg_cron
-- runs inside Supabase and is far more reliable and frequent.
--
-- SECRETS: the endpoint base URL and the CRON_SECRET bearer live in Supabase
-- Vault (secret names 'app_url' and 'cron_secret'), NOT in this file. Insert once
-- (values never committed):
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--   select vault.create_secret('https://sarthak-singapore.vercel.app', 'app_url');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-scheduling with the same job name replaces the existing schedule, so this
-- migration is idempotent. The vault lookups run at tick time, not now, so the
-- job is created even before the secrets exist.
select cron.schedule(
  'dialer-tick',
  '* * * * *', -- every minute
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/voice/process',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);
