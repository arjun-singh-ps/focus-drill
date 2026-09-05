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

## Deploying to Google Cloud Run

Same 3-stage Dockerfile pattern as `pm-ai-toolkit`, with one difference: none of
this app's five env vars are baked into the image at build time. Every one of
them is read server-side at request time (`src/lib/claude.ts`,
`src/lib/supabase.ts`, `src/lib/session.ts`), never in a `"use client"` file, so
none needs to be present when Docker builds the image — all five are supplied to
the running container instead.

Needs `gcloud` CLI installed and authenticated (`gcloud init`), or run everything
from **Cloud Shell** (console.cloud.google.com → the `>_` icon), which has
`gcloud` and Docker preinstalled — no local setup at all.

### One-time setup

```bash
gcloud config set project YOUR_PROJECT_ID

# Store the four sensitive values in Secret Manager rather than as plain env
# vars — Cloud Run env vars show up in plaintext in `gcloud run services
# describe` and revision metadata; secrets don't.
echo -n "sk-ant-..." | gcloud secrets create focus-drill-anthropic-key --data-file=-
echo -n "sb_secret_..." | gcloud secrets create focus-drill-supabase-key --data-file=-
echo -n "your-password" | gcloud secrets create focus-drill-app-password --data-file=-
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | \
  gcloud secrets create focus-drill-session-secret --data-file=-
```

### Deploy

```bash
gcloud run deploy focus-drill \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --timeout=300 \
  --set-env-vars NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co \
  --set-secrets ANTHROPIC_API_KEY=focus-drill-anthropic-key:latest,SUPABASE_SERVICE_ROLE_KEY=focus-drill-supabase-key:latest,APP_PASSWORD=focus-drill-app-password:latest,SESSION_SECRET=focus-drill-session-secret:latest
```

`--source .` builds via Cloud Build using the `Dockerfile` in this repo — no
separate push step needed. `--allow-unauthenticated` is required since this
app's own password gate (`src/proxy.ts`) is the access control, not Google's IAM;
without it, Google's own auth layer would sit in front of the login page nobody
but her needs to see. `--timeout=300` matches the value already set as
`maxDuration` in `src/app/api/session/start/route.ts` for the (harmless, inert
outside Vercel) case this code ever runs there again — Cloud Run's own default is
already 300s, so this flag is really just making that explicit.

To update after a code change, re-run the same `gcloud run deploy` command — it
rebuilds and rolls out a new revision. Rotate a secret with
`echo -n "new-value" | gcloud secrets versions add focus-drill-anthropic-key --data-file=-`
then redeploy so the new revision picks up `:latest`.

### Cost note

Cloud Run scales to zero when idle by default (`--min-instances=0`, the
default), so there's no charge between practice sessions — the tradeoff is a few
seconds of cold-start latency on the first request after a period of inactivity.
Add `--min-instances=1` if that cold start ever bothers her, at the cost of the
container running continuously.

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
