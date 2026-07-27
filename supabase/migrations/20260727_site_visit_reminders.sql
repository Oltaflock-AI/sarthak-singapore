-- Site-visit WhatsApp reminders + booking-send retry (2026-07-27).
-- Already applied to production via the Management API; kept for the record.

-- Per-party booking-send stamps (NULL = never succeeded → visit-reminders
-- retries while the visit is upcoming and <7 days old) and one stamp per
-- reminder tier so the 15-min cron never double-sends.
alter table site_visits
  add column if not exists booking_sales_sent_at  timestamptz,
  add column if not exists booking_client_sent_at timestamptz,
  add column if not exists reminder_24h_sent_at   timestamptz,
  add column if not exists reminder_3h_sent_at    timestamptz,
  add column if not exists reminder_30m_sent_at   timestamptz;

-- Visits already in the past predate the reminder system — mark their booking
-- sends handled so the retry pass never touches them.
update site_visits
   set booking_sales_sent_at  = created_at,
       booking_client_sent_at = created_at
 where scheduled_for < now()
   and booking_sales_sent_at is null;

-- Every 15 minutes, poke the visit-reminders edge function from inside the
-- database. <SUPABASE_ANON_KEY> is the project anon key (the function runs
-- with verify_jwt); the real value lives only in the deployed cron.job row.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'visit-reminders',
  '*/15 * * * *',
  $$ select net.http_post(
       url     := 'https://yhwoqmhnvzpfgacfaidg.supabase.co/functions/v1/visit-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'Authorization', 'Bearer <SUPABASE_ANON_KEY>'),
       body    := '{}'::jsonb
     ) $$
);
