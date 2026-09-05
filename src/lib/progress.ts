// Builds everything the /progress dashboard shows, from the session_log history.
//
// This is the "is the four-week plan actually working" view, so it reads the log
// rather than subskill_stats — the log is what carries the trend, the stats table
// only carries the current state.

import { getSubskill, isKnownSubskill, type Difficulty } from "./satConfig";
import { getSupabaseServiceClient } from "./supabase";
import type { ProgressData, QuestionPayload, TrendPoint } from "@/types";

/** One row of session_log as read back for reporting. */
interface LogRow {
  id: string;
  created_at: string;
  subskill_key: string;
  difficulty: Difficulty;
  was_correct: boolean;
  was_timed_out: boolean;
  sim_mode: boolean;
  timer_enabled: boolean;
  seconds_taken: number | null;
  flagged: boolean;
  question_id: string | null;
}

/** Rows are capped so a runaway log cannot blow up the dashboard request. */
const MAX_ROWS = 20_000;

/** Calendar day (YYYY-MM-DD) for an ISO timestamp, in UTC. */
function dayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/** Reads the whole attempt history, oldest first. */
async function loadLog(): Promise<LogRow[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("session_log")
    .select(
      "id, created_at, subskill_key, difficulty, was_correct, was_timed_out, " +
        "sim_mode, timer_enabled, seconds_taken, flagged, question_id"
    )
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    throw new Error(`Could not load the session log: ${error.message}`);
  }

  // Defensive: drop rows whose subskill has since been removed from satConfig,
  // rather than throwing and taking the whole dashboard down.
  return ((data ?? []) as unknown as LogRow[]).filter((row) =>
    isKnownSubskill(row.subskill_key)
  );
}

/**
 * Builds a per-subskill accuracy trend.
 *
 * Each point is CUMULATIVE accuracy up to and including that day, not that day's
 * accuracy in isolation. With ~3 attempts per subskill per day, a per-day figure
 * would be pure noise (0%, 33%, 100%); the cumulative line actually shows whether
 * she is improving.
 */
function buildTrends(rows: LogRow[]): ProgressData["trends"] {
  const bySubskill = new Map<string, LogRow[]>();

  for (const row of rows) {
    const list = bySubskill.get(row.subskill_key);
    if (list) list.push(row);
    else bySubskill.set(row.subskill_key, [row]);
  }

  return [...bySubskill.entries()]
    .map(([subskillKey, subskillRows]) => {
      const { subskill, domain } = getSubskill(subskillKey);

      // Flagged attempts are excluded from accuracy — a broken question says
      // nothing about her, and letting it count would distort the whole line.
      const scored = subskillRows.filter((r) => !r.flagged);

      const byDay = new Map<string, { attempts: number; correct: number }>();
      for (const row of scored) {
        const day = dayKey(row.created_at);
        const entry = byDay.get(day) ?? { attempts: 0, correct: 0 };
        entry.attempts += 1;
        if (row.was_correct) entry.correct += 1;
        byDay.set(day, entry);
      }

      let runningAttempts = 0;
      let runningCorrect = 0;
      const points: TrendPoint[] = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, entry]) => {
          runningAttempts += entry.attempts;
          runningCorrect += entry.correct;
          return {
            date,
            accuracy: runningAttempts > 0 ? runningCorrect / runningAttempts : null,
            attempts: entry.attempts,
          };
        });

      return {
        subskillKey,
        subskillLabel: subskill.label,
        domainLabel: domain.label,
        points,
        currentAccuracy: runningAttempts > 0 ? runningCorrect / runningAttempts : null,
        totalAttempts: runningAttempts,
      };
    })
    .sort((a, b) => {
      // Weakest first — that is what you actually want to look at.
      const aAcc = a.currentAccuracy ?? 1;
      const bAcc = b.currentAccuracy ?? 1;
      return aAcc - bAcc;
    });
}

/** Total questions attempted per calendar day, including flagged ones. */
function buildDailyVolume(rows: LogRow[]): ProgressData["dailyVolume"] {
  const byDay = new Map<string, { attempts: number; correct: number }>();

  for (const row of rows) {
    const day = dayKey(row.created_at);
    const entry = byDay.get(day) ?? { attempts: 0, correct: 0 };
    entry.attempts += 1;
    if (row.was_correct && !row.flagged) entry.correct += 1;
    byDay.set(day, entry);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({ date, ...entry }));
}

/**
 * Timeout rate per subskill, over timed attempts only.
 *
 * This is the "knows it but is too slow" signal. Untimed attempts are excluded
 * because they cannot time out, and including them would dilute the rate into
 * meaninglessness.
 */
function buildTimeoutBreakdown(rows: LogRow[]): ProgressData["timeoutBreakdown"] {
  const bySubskill = new Map<string, { timedAttempts: number; timeouts: number }>();

  for (const row of rows) {
    if (!row.timer_enabled || row.flagged) continue;
    const entry = bySubskill.get(row.subskill_key) ?? { timedAttempts: 0, timeouts: 0 };
    entry.timedAttempts += 1;
    if (row.was_timed_out) entry.timeouts += 1;
    bySubskill.set(row.subskill_key, entry);
  }

  return [...bySubskill.entries()]
    .map(([subskillKey, entry]) => ({
      subskillKey,
      subskillLabel: getSubskill(subskillKey).subskill.label,
      ...entry,
    }))
    .filter((entry) => entry.timedAttempts > 0)
    .sort((a, b) => b.timeouts / b.timedAttempts - a.timeouts / a.timedAttempts);
}

/** The flagged questions, newest first, with their stems pulled from the bank. */
async function buildFlagged(rows: LogRow[]): Promise<ProgressData["flagged"]> {
  const flaggedRows = rows.filter((row) => row.flagged).reverse();
  if (flaggedRows.length === 0) return [];

  const questionIds = flaggedRows
    .map((row) => row.question_id)
    .filter((id): id is string => typeof id === "string");

  const stemById = new Map<string, string>();

  if (questionIds.length > 0) {
    const { data, error } = await getSupabaseServiceClient()
      .from("question_bank")
      .select("id, payload")
      .in("id", questionIds);

    if (error) {
      throw new Error(`Could not load flagged question text: ${error.message}`);
    }

    for (const row of data ?? []) {
      stemById.set(row.id as string, (row.payload as QuestionPayload).stem);
    }
  }

  return flaggedRows.map((row) => ({
    attemptId: row.id,
    createdAt: row.created_at,
    subskillLabel: getSubskill(row.subskill_key).subskill.label,
    difficulty: row.difficulty,
    stem: row.question_id ? (stemById.get(row.question_id) ?? null) : null,
  }));
}

/** Assembles the full dashboard payload in a single database round trip plus one lookup. */
export async function buildProgressData(): Promise<ProgressData> {
  const rows = await loadLog();
  const scored = rows.filter((row) => !row.flagged);

  return {
    trends: buildTrends(rows),
    dailyVolume: buildDailyVolume(rows),
    timeoutBreakdown: buildTimeoutBreakdown(rows),
    flagged: await buildFlagged(rows),
    totals: {
      attempts: scored.length,
      correct: scored.filter((row) => row.was_correct).length,
      flagged: rows.length - scored.length,
      activeDays: new Set(rows.map((row) => dayKey(row.created_at))).size,
    },
  };
}

/**
 * Renders the whole session log as CSV.
 *
 * Fields are quoted and internal quotes doubled, per RFC 4180, so a stem containing
 * a comma cannot shift every following column.
 */
export async function buildSessionLogCsv(): Promise<string> {
  const rows = await loadLog();

  const header = [
    "timestamp",
    "domain",
    "subskill",
    "subskill_key",
    "difficulty",
    "was_correct",
    "was_timed_out",
    "sim_mode",
    "timer_enabled",
    "seconds_taken",
    "flagged",
  ];

  const lines = [header.join(",")];

  for (const row of rows) {
    const { subskill, domain } = getSubskill(row.subskill_key);

    lines.push(
      [
        row.created_at,
        domain.label,
        subskill.label,
        row.subskill_key,
        row.difficulty,
        row.was_correct,
        row.was_timed_out,
        row.sim_mode,
        row.timer_enabled,
        row.seconds_taken ?? "",
        row.flagged,
      ]
        .map(csvField)
        .join(",")
    );
  }

  return lines.join("\r\n");
}

/** Quotes one CSV field, doubling any internal quotes. */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
