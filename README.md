# Focus Drill

Adaptive SAT practice for one person. Drills the weakest subskills hardest, ramps
difficulty as accuracy improves, and keeps a full history so you can see whether a
four-week plan is actually working.

Built for a 1530+ target with known weakness in **Algebra**, **Advanced Math** and
**Information and Ideas** — those three domains are on by default; the other five
are opt-in.

---

## What it does

- **Weighted adaptive selection.** Weaker subskills come up roughly 10× more often
  than strong ones, with a cold-start boost so everything gets sampled early and a
  spaced-revisit nudge so nothing is neglected for a week.
- **Adaptive difficulty per subskill.** easy / medium / hard, from rolling accuracy
  over the last five attempts in that subskill.
- **Test-day simulation.** Forces hard questions only, bypassing the ladder.
- **Timed mode.** 95s per Math question, 71s per Reading and Writing question — real
  digital SAT module pacing. Running out auto-submits as incorrect.
- **A progress dashboard** at `/progress` with per-subskill accuracy trends, daily
  volume, a "too slow vs does not know it" breakdown, and CSV export.

The exact selection and difficulty maths, with the reasoning behind every constant,
is documented in [`src/lib/adaptive.ts`](src/lib/adaptive.ts).

---

## Setup

### 1. Install

```bash
npm install
```

Requires Node 20 or newer.

### 2. Create the Supabase project

Make a new project at [supabase.com](https://supabase.com), then open the **SQL
Editor** and run these two files in order, pasting each in whole:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_enable_rls.sql`

There is no migration runner — these are applied by hand, once. Both are safe to
re-run if you are unsure whether they went through.

### 3. Environment variables

```bash
cp .env.example .env.local
```

Then fill in:

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, **service_role** key (not the anon key) |
| `APP_PASSWORD` | Whatever you want to share with her |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

The service-role key bypasses row-level security and must never reach the browser.
It is only ever read in [`src/lib/supabase.ts`](src/lib/supabase.ts), which is
server-only.

### 4. Run it

```bash
npm run dev     # http://localhost:3000
npm test        # unit tests for the adaptive engine
npm run lint
```

---

## Deploying to Vercel

1. Push to a GitHub repo.
2. Import it at vercel.com — the framework is detected automatically.
3. Add all five environment variables from `.env.local` under **Settings →
   Environment Variables**.
4. Deploy.

`/api/session/start` sets `maxDuration = 300` because warming several Opus
generations takes longer than Vercel's default function timeout.

---

## How it is put together

```
src/lib/satConfig.ts        Domain + subskill taxonomy. Single source of truth.
src/lib/adaptive.ts         Pure selection + difficulty logic. No I/O. Fully tested.
src/lib/questionGenerator.ts  One Claude call → one validated question.
src/lib/questionBank.ts     Pre-generation, duplicate rejection, top-up.
src/lib/nextQuestion.ts     Ties the engine to the database.
src/lib/stats.ts            Settings, rolling stats, the attempt log.
src/lib/progress.ts         Dashboard aggregation + CSV.
src/lib/session.ts          Password gate, HMAC-signed cookie.
src/proxy.ts                The auth gate (Next 16's renamed middleware.ts).
```

### Why questions are pre-generated

An Opus generation takes 20–40 seconds. In a 95-second timed drill, waiting a third
of the budget between questions destroys the pacing practice the timer exists to
build. So `/api/session/start` warms a small bank before the session, and every
`/api/next-question` tops it back up in the background via `waitUntil`. Serving is
then a single instant database read.

### Why grading is server-side

The client never receives `correctIndex` or the explanation until after it posts an
answer, so the key cannot be read out of devtools. It also means the log is written
from what the server knows rather than from what the browser claims.

### Cost and rate limiting

`/api/next-question` and `/api/session/start` are the only cost-bearing endpoints.
Generation is capped at **200 questions per rolling hour**, enforced by counting
`question_bank` rows created in the last hour — the counter lives in Postgres
because Vercel's multiple instances and cold starts make an in-memory one
meaningless.

At Opus 5 pricing this works out around **$0.05 per question**, so roughly $50 for
1,100 questions across four weeks.

### Flagged questions

AI-generated questions occasionally carry a wrong answer key. The flag button voids
the attempt — it stops counting against her accuracy, so a single bad item cannot
make the adaptive weighting over-drill a subskill she is fine at. Flagged questions
are listed on `/progress`; several from one subskill means the generator is
struggling there and that prompt needs attention.

---

## Provenance note

This was rebuilt from a written specification, not ported from the original
`sat-focus-drill.jsx` prototype (which was never supplied). The algorithm constants
in `src/lib/adaptive.ts` are therefore a fresh design. If the original turns up,
they are all grouped at the top of that file with their reasoning, so reconciling
the two is a matter of changing numbers rather than rewriting logic.
