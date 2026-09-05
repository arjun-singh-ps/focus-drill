-- Focus Drill — initial schema.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL Editor and run it once.
-- There is no migration runner in this project (same convention as pm-ai-toolkit).
--
-- Four tables:
--   subskill_stats  rolling state, one row per subskill — drives the adaptive weighting
--   session_log     immutable history, one row per attempt — drives the trend charts
--   question_bank   pre-generated questions, so practice never waits on the API
--   app_settings    a single row of practice preferences

-- ---------------------------------------------------------------------------
-- subskill_stats: the "where is she now" table.
-- Kept separate from session_log so the hot selection path is a single small read
-- rather than an aggregate over an ever-growing log.
-- ---------------------------------------------------------------------------
create table if not exists subskill_stats (
  subskill_key       text primary key,
  correct_count      integer     not null default 0 check (correct_count >= 0),
  total_count        integer     not null default 0 check (total_count >= 0),
  last_attempted_at  timestamptz,
  constraint correct_not_above_total check (correct_count <= total_count)
);

-- ---------------------------------------------------------------------------
-- question_bank: every question ever generated.
--
-- Serving from here rather than generating on demand is what keeps the gap between
-- questions at ~0s instead of the 20-40s an Opus generation takes. It also gives
-- repeat-prevention (via stem_hash) and makes the hourly rate limit a simple
-- count of rows created in the last hour.
-- ---------------------------------------------------------------------------
create table if not exists question_bank (
  id            uuid primary key default gen_random_uuid(),
  subskill_key  text        not null,
  difficulty    text        not null check (difficulty in ('easy', 'medium', 'hard')),
  -- { passage?, stem, choices[4], correctIndex, explanation }
  payload       jsonb       not null,
  -- Hash of the normalised stem. Used to reject a near-duplicate before storing it.
  stem_hash     text        not null,
  created_at    timestamptz not null default now(),
  -- Null means "still in the bank". Set when the question is handed to the client.
  served_at     timestamptz
);

-- The hot path: find an unserved question for a given cell. Partial index because
-- served rows are dead weight for this query and the table only grows.
create index if not exists question_bank_unserved_idx
  on question_bank (subskill_key, difficulty, created_at)
  where served_at is null;

-- Backs the hourly rate-limit count.
create index if not exists question_bank_created_at_idx on question_bank (created_at);

-- Backs duplicate detection within a subskill.
create index if not exists question_bank_stem_hash_idx on question_bank (subskill_key, stem_hash);

-- ---------------------------------------------------------------------------
-- session_log: the history. Append-only; rows are never deleted, and the only
-- update ever made is setting `flagged`.
--
-- was_timed_out is stored separately from was_correct even though a timeout counts
-- as incorrect. That distinction is the difference between "does not know it" and
-- "knows it but is too slow", which need completely different remedies.
-- ---------------------------------------------------------------------------
create table if not exists session_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  subskill_key   text        not null,
  difficulty     text        not null check (difficulty in ('easy', 'medium', 'hard')),
  was_correct    boolean     not null,
  was_timed_out  boolean     not null default false,
  sim_mode       boolean     not null default false,
  timer_enabled  boolean     not null default false,
  -- Wall-clock seconds spent on the question. Makes "too slow" visible as a trend,
  -- not just as a binary timeout flag.
  seconds_taken  integer     check (seconds_taken >= 0),
  -- Set when she reports a broken question. A flagged attempt is voided: its
  -- contribution to subskill_stats is reversed and it is excluded from accuracy.
  flagged        boolean     not null default false,
  question_id    uuid        references question_bank (id) on delete set null
);

-- Backs both the difficulty ladder's per-subskill window and the trend charts.
create index if not exists session_log_subskill_created_idx
  on session_log (subskill_key, created_at desc);

create index if not exists session_log_created_at_idx on session_log (created_at);

-- ---------------------------------------------------------------------------
-- app_settings: exactly one row, ever.
--
-- The `id boolean primary key default true check (id)` trick is a standard way to
-- make a single-row table enforce itself — the only value that satisfies both the
-- primary key and the check is `true`, so a second row is impossible.
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  id               boolean primary key default true check (id),
  enabled_domains  text[]  not null default array[
                     'algebra', 'advanced-math', 'information-and-ideas'
                   ],
  sim_mode         boolean not null default false,
  timer_enabled    boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- Seed the single settings row. Idempotent, so re-running this file is safe.
insert into app_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- apply_attempt: atomically fold one attempt into subskill_stats.
--
-- Done in SQL rather than as a read-modify-write in TypeScript because the latter
-- can lose an update if two writes interleave. That is unlikely with one user
-- answering one question at a time, but "unlikely" bugs in a scoring system are
-- exactly the ones that silently corrupt four weeks of data.
--
-- `delta` is +1 when logging an attempt and -1 when a flagged question is voided,
-- which is why correct_delta and total_delta are passed rather than assumed.
-- ---------------------------------------------------------------------------
create or replace function apply_attempt(
  p_subskill_key  text,
  p_correct_delta integer,
  p_total_delta   integer,
  p_attempted_at  timestamptz
) returns void
language plpgsql
as $$
begin
  insert into subskill_stats (subskill_key, correct_count, total_count, last_attempted_at)
  values (
    p_subskill_key,
    greatest(0, p_correct_delta),
    greatest(0, p_total_delta),
    p_attempted_at
  )
  on conflict (subskill_key) do update
    set correct_count = greatest(0, subskill_stats.correct_count + p_correct_delta),
        total_count   = greatest(0, subskill_stats.total_count   + p_total_delta),
        -- Only advance the timestamp; voiding a flagged attempt must not rewind it.
        last_attempted_at = greatest(
          coalesce(subskill_stats.last_attempted_at, p_attempted_at),
          p_attempted_at
        );
end;
$$;
