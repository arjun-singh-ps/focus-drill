// Data access for settings, rolling stats and the attempt log.
//
// Everything the adaptive engine needs to read, and everything answering a question
// writes. Kept separate from adaptive.ts so that file stays pure and testable.

import { emptyStat, type AttemptRecord, type SubskillStat } from "./adaptive";
import {
  DEFAULT_ENABLED_DOMAINS,
  isKnownSubskill,
  subskillKeysForDomains,
  type Difficulty,
} from "./satConfig";
import { getSupabaseServiceClient } from "./supabase";
import type { AppSettings } from "@/types";

/** Reads the single app_settings row, falling back to defaults if it is missing. */
export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await getSupabaseServiceClient()
    .from("app_settings")
    .select("enabled_domains, sim_mode, timer_enabled")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load settings: ${error.message}`);
  }

  if (!data) {
    return {
      enabledDomains: DEFAULT_ENABLED_DOMAINS,
      simMode: false,
      timerEnabled: false,
    };
  }

  const enabled = (data.enabled_domains as string[] | null) ?? [];

  return {
    // Never return an empty domain list — that would leave pickSubskill with
    // nothing to choose from and throw mid-session.
    enabledDomains: enabled.length > 0 ? enabled : DEFAULT_ENABLED_DOMAINS,
    simMode: Boolean(data.sim_mode),
    timerEnabled: Boolean(data.timer_enabled),
  };
}

/** Writes the single app_settings row. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const { error } = await getSupabaseServiceClient()
    .from("app_settings")
    .update({
      enabled_domains: settings.enabledDomains,
      sim_mode: settings.simMode,
      timer_enabled: settings.timerEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) {
    throw new Error(`Could not save settings: ${error.message}`);
  }
}

/**
 * Loads rolling stats for every subskill in the enabled domains.
 *
 * Subskills with no row yet are returned as zeroed stats rather than omitted, so
 * the cold-start boost in the weighting can actually see them.
 */
export async function loadStatsForDomains(
  enabledDomains: readonly string[]
): Promise<SubskillStat[]> {
  const keys = subskillKeysForDomains(enabledDomains);
  if (keys.length === 0) return [];

  const { data, error } = await getSupabaseServiceClient()
    .from("subskill_stats")
    .select("subskill_key, correct_count, total_count, last_attempted_at")
    .in("subskill_key", keys);

  if (error) {
    throw new Error(`Could not load subskill stats: ${error.message}`);
  }

  const bySubskill = new Map<string, SubskillStat>(
    (data ?? []).map((row) => [
      row.subskill_key as string,
      {
        subskillKey: row.subskill_key as string,
        correctCount: row.correct_count as number,
        totalCount: row.total_count as number,
        lastAttemptedAt: (row.last_attempted_at as string | null) ?? null,
      },
    ])
  );

  return keys.map((key) => bySubskill.get(key) ?? emptyStat(key));
}

/**
 * The most recent non-flagged attempts for a subskill, newest first.
 *
 * Flagged attempts are excluded because a broken question tells us nothing about
 * whether she is ready for harder material — counting it would drag the ladder down.
 */
export async function recentAttemptsForSubskill(
  subskillKey: string,
  limit: number
): Promise<AttemptRecord[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("session_log")
    .select("subskill_key, was_correct")
    .eq("subskill_key", subskillKey)
    .eq("flagged", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not load recent attempts: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    subskillKey: row.subskill_key as string,
    wasCorrect: row.was_correct as boolean,
  }));
}

/** The subskill served most recently, so the no-repeat rule has something to compare. */
export async function lastServedSubskill(): Promise<string | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("session_log")
    .select("subskill_key")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the last served subskill: ${error.message}`);
  }

  const key = data?.subskill_key as string | undefined;
  return key && isKnownSubskill(key) ? key : null;
}

/** Everything needed to write one attempt to the log. */
export interface AttemptInput {
  subskillKey: string;
  difficulty: Difficulty;
  wasCorrect: boolean;
  wasTimedOut: boolean;
  /** Which of the four choices was picked. Null only when it timed out unanswered. */
  chosenIndex: number | null;
  simMode: boolean;
  timerEnabled: boolean;
  secondsTaken: number;
  questionId: string;
}

/**
 * Logs an attempt and folds it into the rolling stats.
 *
 * The two writes are not in one transaction — Supabase's REST client cannot span
 * them. The log write goes first, so the worst case is an attempt recorded in the
 * history but not yet in the rolling stats, which self-corrects on the next
 * attempt and leaves the trend charts (built from the log) correct regardless.
 *
 * @returns the new session_log row id
 */
export async function recordAttempt(input: AttemptInput): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const attemptedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("session_log")
    .insert({
      created_at: attemptedAt,
      subskill_key: input.subskillKey,
      difficulty: input.difficulty,
      was_correct: input.wasCorrect,
      was_timed_out: input.wasTimedOut,
      chosen_index: input.chosenIndex,
      sim_mode: input.simMode,
      timer_enabled: input.timerEnabled,
      seconds_taken: input.secondsTaken,
      question_id: input.questionId,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not record the attempt: ${error.message}`);
  }

  const { error: statsError } = await supabase.rpc("apply_attempt", {
    p_subskill_key: input.subskillKey,
    p_correct_delta: input.wasCorrect ? 1 : 0,
    p_total_delta: 1,
    p_attempted_at: attemptedAt,
  });

  if (statsError) {
    throw new Error(`Could not update subskill stats: ${statsError.message}`);
  }

  return data.id as string;
}

/**
 * Marks an attempt as a broken question and reverses its effect on the stats.
 *
 * Voiding rather than deleting: the row stays in session_log so the question is
 * still visible on /progress, but it stops counting against her accuracy and stops
 * the adaptive weighting over-drilling a subskill because of a bad answer key.
 *
 * Idempotent — flagging an already-flagged attempt does nothing, so a double-tap
 * cannot double-reverse the stats.
 */
export async function flagAttempt(attemptId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();

  // The `.eq("flagged", false)` is what makes this idempotent: a second call
  // matches zero rows and returns null.
  const { data, error } = await supabase
    .from("session_log")
    .update({ flagged: true })
    .eq("id", attemptId)
    .eq("flagged", false)
    .select("subskill_key, was_correct, created_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not flag the attempt: ${error.message}`);
  }

  if (!data) return false;

  const { error: statsError } = await supabase.rpc("apply_attempt", {
    p_subskill_key: data.subskill_key as string,
    p_correct_delta: (data.was_correct as boolean) ? -1 : 0,
    p_total_delta: -1,
    p_attempted_at: data.created_at as string,
  });

  if (statsError) {
    throw new Error(`Could not reverse the flagged attempt: ${statsError.message}`);
  }

  return true;
}
