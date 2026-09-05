// Hourly cap on question generation — the only cost-bearing operation in the app.
//
// The counter lives in Postgres rather than in memory on purpose. Vercel runs
// multiple instances and cold-starts constantly, so an in-process Map would reset
// unpredictably and the "limit" would mean nothing. Every generation inserts
// exactly one question_bank row, so counting rows in the last hour IS the counter —
// no separate bookkeeping table to keep in sync.

import { getSupabaseServiceClient } from "./supabase";

/** Maximum questions generated per rolling hour. */
export const MAX_GENERATIONS_PER_HOUR = 200;

const ONE_HOUR_MS = 60 * 60 * 1000;

/** How much generation headroom is left in the current rolling hour. */
export interface RateLimitStatus {
  used: number;
  remaining: number;
  limited: boolean;
}

/**
 * Counts generations in the last rolling hour.
 *
 * @throws if the count query fails — a failed count must not be treated as zero,
 * because that would silently disable the limit exactly when the database is
 * struggling.
 */
export async function getRateLimitStatus(): Promise<RateLimitStatus> {
  const since = new Date(Date.now() - ONE_HOUR_MS).toISOString();

  const { count, error } = await getSupabaseServiceClient()
    .from("question_bank")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  if (error) {
    throw new Error(`Could not check the generation rate limit: ${error.message}`);
  }

  const used = count ?? 0;
  return {
    used,
    remaining: Math.max(0, MAX_GENERATIONS_PER_HOUR - used),
    limited: used >= MAX_GENERATIONS_PER_HOUR,
  };
}

/**
 * Throws a recognisable error when the hourly cap is spent.
 * Route handlers catch this and turn it into a 429.
 */
export class RateLimitExceededError extends Error {
  constructor(public readonly status: RateLimitStatus) {
    super(
      `Hourly question limit reached (${status.used}/${MAX_GENERATIONS_PER_HOUR}). ` +
        `Try again shortly.`
    );
    this.name = "RateLimitExceededError";
  }
}

/** Throws RateLimitExceededError if there is no headroom left. */
export async function assertWithinRateLimit(): Promise<RateLimitStatus> {
  const status = await getRateLimitStatus();
  if (status.limited) {
    throw new RateLimitExceededError(status);
  }
  return status;
}
