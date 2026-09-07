// Builds the /review page: every attempted question with what she picked, the
// answer key, and the explanation — a browsable study list, distinct from
// /progress's charts. Reads session_log joined with question_bank, since the log
// alone only has correct/incorrect, not the actual question text.

import { getSubskill, isKnownSubskill, type Difficulty } from "./satConfig";
import { getSupabaseServiceClient } from "./supabase";
import type { QuestionPayload, ReviewFilters, ReviewItem, ReviewPage } from "@/types";

/** One page of results, capped so a long history cannot load as one giant request. */
const MAX_PAGE_SIZE = 50;

interface LogRow {
  id: string;
  created_at: string;
  subskill_key: string;
  difficulty: Difficulty;
  was_correct: boolean;
  was_timed_out: boolean;
  chosen_index: number | null;
  question_id: string | null;
}

/**
 * Loads one page of reviewable attempts, newest first.
 *
 * Flagged attempts are always excluded — a broken question's stored "correct"
 * answer may itself be wrong, so presenting it as something to study would be
 * actively counterproductive, not just noise.
 */
export async function loadReviewPage(filters: ReviewFilters): Promise<ReviewPage> {
  const supabase = getSupabaseServiceClient();
  const limit = Math.min(filters.limit, MAX_PAGE_SIZE);

  let query = supabase
    .from("session_log")
    .select("id, created_at, subskill_key, difficulty, was_correct, was_timed_out, chosen_index, question_id")
    .eq("flagged", false)
    .not("question_id", "is", null)
    .order("created_at", { ascending: false })
    // Fetch one extra row so hasMore can be known without a second count query.
    .range(filters.offset, filters.offset + limit);

  if (filters.outcome === "correct") query = query.eq("was_correct", true);
  if (filters.outcome === "incorrect") query = query.eq("was_correct", false);
  if (filters.subskillKey) query = query.eq("subskill_key", filters.subskillKey);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load the review log: ${error.message}`);
  }

  const rows = ((data ?? []) as unknown as LogRow[]).filter((row) =>
    isKnownSubskill(row.subskill_key)
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const questionIds = page
    .map((row) => row.question_id)
    .filter((id): id is string => typeof id === "string");

  const payloadById = new Map<string, QuestionPayload>();

  if (questionIds.length > 0) {
    const { data: questions, error: questionError } = await supabase
      .from("question_bank")
      .select("id, payload")
      .in("id", questionIds);

    if (questionError) {
      throw new Error(`Could not load question text: ${questionError.message}`);
    }

    for (const row of questions ?? []) {
      payloadById.set(row.id as string, row.payload as QuestionPayload);
    }
  }

  const items: ReviewItem[] = page
    .map((row): ReviewItem | null => {
      if (!row.question_id) return null;
      const payload = payloadById.get(row.question_id);
      // The question row can be missing if it was ever deleted directly in
      // Supabase — skip rather than render a card with no question text.
      if (!payload) return null;

      const { subskill, domain } = getSubskill(row.subskill_key);

      return {
        attemptId: row.id,
        createdAt: row.created_at,
        subskillKey: row.subskill_key,
        subskillLabel: subskill.label,
        domainLabel: domain.label,
        difficulty: row.difficulty,
        wasCorrect: row.was_correct,
        wasTimedOut: row.was_timed_out,
        chosenIndex: row.chosen_index,
        passage: payload.passage,
        stem: payload.stem,
        choices: payload.choices,
        correctIndex: payload.correctIndex,
        explanation: payload.explanation,
      };
    })
    .filter((item): item is ReviewItem => item !== null);

  return { items, hasMore };
}
