// The question bank: pre-generated questions, so practice never waits on the API.
//
// Why this exists at all: an Opus generation takes 20-40s. In a 95s-per-question
// timed drill, staring at a spinner for a third of that budget between questions
// destroys the pacing practice the timer is meant to build. So questions are
// generated ahead of time and served instantly from Postgres.

import { generateQuestion, stemHash } from "./questionGenerator";
import { assertWithinRateLimit, RateLimitExceededError } from "./rateLimit";
import { getSupabaseServiceClient } from "./supabase";
import type { Difficulty } from "./satConfig";
import type { QuestionPayload } from "@/types";

/** How many recent stems to show the generator so it avoids repeating itself. */
const AVOID_STEM_COUNT = 10;

/** A question taken from the bank, with its database id. */
export interface BankedQuestion {
  id: string;
  subskillKey: string;
  difficulty: Difficulty;
  payload: QuestionPayload;
}

/**
 * Takes one unserved question out of the bank for a cell, marking it served.
 *
 * Returns null when the bank is empty for that cell — the caller then generates
 * inline, which is slow but correct.
 *
 * The claim is optimistic: we read a candidate, then update it only if it is still
 * unserved. If another request beat us to it the update matches zero rows and we
 * try the next candidate. With a single user this is near-never, but a prefetch
 * racing a real request is exactly the case that would otherwise serve the same
 * question twice.
 */
export async function takeFromBank(
  subskillKey: string,
  difficulty: Difficulty
): Promise<BankedQuestion | null> {
  const supabase = getSupabaseServiceClient();

  const { data: candidates, error } = await supabase
    .from("question_bank")
    .select("id, subskill_key, difficulty, payload")
    .eq("subskill_key", subskillKey)
    .eq("difficulty", difficulty)
    .is("served_at", null)
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    throw new Error(`Could not read the question bank: ${error.message}`);
  }

  for (const candidate of candidates ?? []) {
    const { data: claimed, error: claimError } = await supabase
      .from("question_bank")
      .update({ served_at: new Date().toISOString() })
      .eq("id", candidate.id)
      .is("served_at", null) // the optimistic lock
      .select("id")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Could not claim a banked question: ${claimError.message}`);
    }

    if (claimed) {
      return {
        id: candidate.id as string,
        subskillKey: candidate.subskill_key as string,
        difficulty: candidate.difficulty as Difficulty,
        payload: candidate.payload as QuestionPayload,
      };
    }
    // Lost the race — fall through and try the next candidate.
  }

  return null;
}

/**
 * Claims one specific banked question by id, marking it served.
 *
 * Returns false if it was already served. Used when we have just generated a
 * question and want that exact one, rather than whatever takeFromBank happens to
 * return next.
 */
export async function claimQuestion(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseServiceClient()
    .from("question_bank")
    .update({ served_at: new Date().toISOString() })
    .eq("id", id)
    .is("served_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not claim question ${id}: ${error.message}`);
  }

  return Boolean(data);
}

/** How many unserved questions the bank holds for a cell. */
export async function bankDepth(
  subskillKey: string,
  difficulty: Difficulty
): Promise<number> {
  const { count, error } = await getSupabaseServiceClient()
    .from("question_bank")
    .select("id", { count: "exact", head: true })
    .eq("subskill_key", subskillKey)
    .eq("difficulty", difficulty)
    .is("served_at", null);

  if (error) {
    throw new Error(`Could not measure bank depth: ${error.message}`);
  }
  return count ?? 0;
}

/** The most recent stems for a subskill, newest first, for repeat-avoidance. */
async function recentStems(subskillKey: string): Promise<string[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("question_bank")
    .select("payload")
    .eq("subskill_key", subskillKey)
    .order("created_at", { ascending: false })
    .limit(AVOID_STEM_COUNT);

  if (error) {
    throw new Error(`Could not read recent stems: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => (row.payload as QuestionPayload)?.stem)
    .filter((stem): stem is string => typeof stem === "string");
}

/**
 * Generates one question and stores it in the bank.
 *
 * Checks the rate limit first, and rejects a question whose stem duplicates one
 * already stored for that subskill. Returns null on a duplicate — the caller can
 * decide whether that is worth retrying.
 *
 * @throws RateLimitExceededError when the hourly cap is spent.
 */
export async function generateIntoBank(
  subskillKey: string,
  difficulty: Difficulty
): Promise<BankedQuestion | null> {
  await assertWithinRateLimit();

  const avoidStems = await recentStems(subskillKey);
  const payload = await generateQuestion({ subskillKey, difficulty, avoidStems });
  const hash = stemHash(payload.stem);

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: dupeError } = await supabase
    .from("question_bank")
    .select("id")
    .eq("subskill_key", subskillKey)
    .eq("stem_hash", hash)
    .limit(1)
    .maybeSingle();

  if (dupeError) {
    throw new Error(`Could not check for duplicate questions: ${dupeError.message}`);
  }

  if (existing) {
    // Discard rather than store. The API call is already paid for either way; what
    // we are protecting is her seeing the same question twice.
    return null;
  }

  const { data, error } = await supabase
    .from("question_bank")
    .insert({
      subskill_key: subskillKey,
      difficulty,
      payload,
      stem_hash: hash,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not store a generated question: ${error.message}`);
  }

  return { id: data.id as string, subskillKey, difficulty, payload };
}

/**
 * Tops the bank up to `targetDepth` for each of the given cells.
 *
 * Runs cells in parallel but caps concurrency implicitly by only ever being called
 * with a handful of cells. Failures are swallowed per cell and reported in the
 * return value: a top-up is best-effort background work, and one failed generation
 * must never break the request that triggered it.
 *
 * @returns how many questions were successfully added
 */
export async function topUpBank(
  cells: readonly { subskillKey: string; difficulty: Difficulty }[],
  targetDepth: number
): Promise<{ added: number; rateLimited: boolean }> {
  let added = 0;
  let rateLimited = false;

  await Promise.all(
    cells.map(async (cell) => {
      try {
        const depth = await bankDepth(cell.subskillKey, cell.difficulty);
        const needed = Math.max(0, targetDepth - depth);

        for (let i = 0; i < needed; i += 1) {
          const stored = await generateIntoBank(cell.subskillKey, cell.difficulty);
          if (stored) added += 1;
        }
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          rateLimited = true;
          return;
        }
        // Best-effort: log and move on. The next request will try again, and if the
        // bank is empty when she needs a question, the route generates inline.
        console.error(
          `Bank top-up failed for ${cell.subskillKey}/${cell.difficulty}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );

  return { added, rateLimited };
}
