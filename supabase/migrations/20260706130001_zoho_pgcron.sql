-- Zoho lead sync on pg_cron (replaces the GitHub Actions schedule, same as the
-- dialer tick in 20260706130000). Every 6 hours Postgres POSTs the Vercel
-- /api/zoho/sync endpoint, which pulls newly-flagged "Not Answer" Singapore
-- Miracle leads from Zoho CRM into the dialer queue (idempotent, deduped by phone).
--
-- Secrets come from Supabase Vault ('app_url', 'cron_secret') — see 20260706130000.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'zoho-sync',
  '15 0,6,12,18 * * *', -- every 6 hours, at :15
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/zoho/sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $job$
);
