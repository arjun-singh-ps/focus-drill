-- Focus Drill — lock the tables down.
--
-- HOW TO APPLY: paste into the Supabase SQL Editor and run once, after 0001_init.sql.
--
-- This app does not use Supabase Auth. Access control is the signed session cookie
-- checked in src/proxy.ts, and every database read/write goes through the
-- service-role key server-side (src/lib/supabase.ts).
--
-- The service-role key bypasses RLS by design, so enabling RLS with NO policies at
-- all means: the app keeps working, and anyone who somehow obtains the anon key can
-- read nothing. This is stricter than pm-ai-toolkit's permissive
-- "authenticated_full_access" policy, because here there is no authenticated
-- Postgres role that legitimately needs access.

alter table subskill_stats enable row level security;
alter table question_bank  enable row level security;
alter table session_log    enable row level security;
alter table app_settings   enable row level security;

-- Deliberately no `create policy` statements. With RLS on and no policies, every
-- non-service-role request is denied. If you ever add a client that talks to
-- Supabase directly with the anon key, it will fail here — that is intended, and
-- the fix is to route it through an API route, not to loosen this file.
