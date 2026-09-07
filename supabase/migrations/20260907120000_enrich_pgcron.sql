-- Post-call AI enrichment on pg_cron (same pattern as the dialer tick and the
-- Zoho sync — Vercel Hobby rejects sub-daily crons, see 20260706130000).
--
-- Why a cron at all: enrichment used to be fired by the dashboard in the
-- browser, gated on a `transcript` field that /api/calls deliberately omits
-- from the list payload. It therefore never ran once — every call on the
-- dashboard showed the webhook's heuristic score and a keyword-regex sentiment.
-- The backfill endpoint does the work server-side, newest-and-most-valuable
-- first (booked site visits, then the longest conversations).
--
-- Every 10 minutes, 10 calls per tick: comfortably ahead of call volume, and a
-- gentle rate against the LLM provider.
--
-- Secrets come from Supabase Vault ('app_url', 'cron_secret') — see 20260706130000.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'call-enrichment',
  '*/10 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/calls/enrich/backfill?limit=10',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 280000
  );
  $job$
);
