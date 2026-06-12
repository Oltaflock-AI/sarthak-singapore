-- Block the public anon key from reading any data.
-- The dashboard now reads through gated server routes using the service role,
-- which bypasses both RLS and these revokes. Webhooks + dialer also use the
-- service role. So locking anon/authenticated out breaks nothing in the app.

-- 1) Enable RLS on every table in public (deny-by-default; no policies = no rows).
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;

-- 2) Strip table/sequence/function privileges from the anon + authenticated roles.
revoke all privileges on all tables    in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

-- 3) Don't auto-grant to them on future objects either.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions  from anon, authenticated;
