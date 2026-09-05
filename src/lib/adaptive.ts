// The adaptive engine: which subskill to serve next, and at what difficulty.
//
// Everything here is a pure function — no database, no clock reads except via an
// injected `now`. That is deliberate: this is the part of the app whose behaviour
// is hardest to eyeball and easiest to get subtly wrong, so it has to be
// exhaustively unit-testable (see tests/unit/adaptive.test.ts).
//
// NOTE ON PROVENANCE: this is a reconstruction from a written spec, not a port of
// the original sat-focus-drill.jsx prototype (which was never supplied). The
// constants below are documented with their reasoning so they can be re-tuned
// against the original if it turns up.

import type { Difficulty } from "./satConfig";

/** Rolling per-subskill state, mirroring the subskill_stats table. */
export interface SubskillStat {
  subskillKey: string;
  correctCount: number;
  totalCount: number;
  /** ISO timestamp, or null if never attempted. */
  lastAttemptedAt: string | null;
}

/** One past attempt, oldest-first when passed as a window. Mirrors session_log. */
export interface AttemptRecord {
  subskillKey: string;
  wasCorrect: boolean;
}

// --- Tuning constants -------------------------------------------------------
// Grouped here so they can be adjusted in one place after a week of real data.

/**
 * Ceiling used in the (CEILING - accuracy) weight term.
 *
 * Why 1.05 and not 1.0: at 100% accuracy a (1 - accuracy) term collapses to zero,
 * which would permanently exclude a mastered subskill from selection. The 0.05
 * headroom leaves mastered material in light rotation instead of dropping it.
 */
const ACCURACY_CEILING = 1.05;

/**
 * Exponent applied to the accuracy gap.
 *
 * Squaring widens the gap between weak and strong without starving anything:
 * a 40%-accuracy subskill lands near 0.42, an 85% one near 0.04 — roughly 10:1.
 * Raising this drills weaknesses harder but revisits strengths less.
 */
const WEIGHT_EXPONENT = 2;

/** Attempts below which a subskill still counts as unexplored. */
const COLD_START_THRESHOLD = 3;

/** Multiplier applied while a subskill is still unexplored, so it gets sampled early. */
const COLD_START_BOOST = 1.5;

/** Days of neglect after which a subskill gets a spaced-repetition nudge. */
const STALE_AFTER_DAYS = 3;

/** Multiplier applied to a stale subskill. */
const STALE_BOOST = 1.25;

/** How many recent attempts the difficulty ladder looks at. */
export const DIFFICULTY_WINDOW = 5;

/** Attempts needed before the ladder will move off its starting rung. */
const MIN_ATTEMPTS_FOR_LADDER = 3;

/** Rolling accuracy at or above which the ladder serves hard questions. */
const HARD_THRESHOLD = 0.8;

/** Rolling accuracy at or above which the ladder serves medium questions. */
const MEDIUM_THRESHOLD = 0.5;

const MS_PER_DAY = 86_400_000;

// --- Accuracy ---------------------------------------------------------------

/**
 * Laplace-smoothed accuracy for a subskill: (correct + 1) / (total + 2).
 *
 * The smoothing means an untried subskill scores exactly 0.5 rather than dividing
 * by zero, so it enters the pool at middling priority instead of either crashing
 * or dominating. It also stops a single lucky first answer reading as 100%.
 */
export function smoothedAccuracy(stat: SubskillStat): number {
  return (stat.correctCount + 1) / (stat.totalCount + 2);
}

/** Raw accuracy for display. Returns null when there is nothing to divide. */
export function rawAccuracy(stat: SubskillStat): number | null {
  if (stat.totalCount === 0) return null;
  return stat.correctCount / stat.totalCount;
}

// --- Selection weighting ----------------------------------------------------

/**
 * The selection weight for one subskill. Higher means more likely to be served.
 *
 * weight = (1.05 - smoothedAccuracy)^2       <- weaker means heavier
 *        * cold-start boost                  <- sample everything early
 *        * staleness boost                   <- do not neglect anything for a week
 *
 * @param stat the subskill's rolling stats
 * @param now  current time, injected so tests are deterministic
 */
export function selectionWeight(stat: SubskillStat, now: Date): number {
  const gap = ACCURACY_CEILING - smoothedAccuracy(stat);
  let weight = Math.pow(gap, WEIGHT_EXPONENT);

  if (stat.totalCount < COLD_START_THRESHOLD) {
    weight *= COLD_START_BOOST;
  }

  if (isStale(stat, now)) {
    weight *= STALE_BOOST;
  }

  return weight;
}

/**
 * True when a subskill has gone STALE_AFTER_DAYS without an attempt.
 * A never-attempted subskill is not "stale" — the cold-start boost already covers it,
 * and stacking both would over-weight it on day one.
 */
function isStale(stat: SubskillStat, now: Date): boolean {
  if (!stat.lastAttemptedAt) return false;
  const elapsedDays = (now.getTime() - new Date(stat.lastAttemptedAt).getTime()) / MS_PER_DAY;
  return elapsedDays >= STALE_AFTER_DAYS;
}

/**
 * Picks the next subskill, weighted so weaker subskills come up more often.
 *
 * Avoids repeating `lastServedKey` whenever there is at least one alternative, so
 * a run does not clump on a single skill. If every candidate is excluded by that
 * rule (i.e. only one subskill is enabled), the rule yields and the repeat happens.
 *
 * @param stats          rolling stats for every ENABLED subskill; must be non-empty
 * @param lastServedKey  the subskill served immediately before, or null
 * @param now            current time, injected for determinism
 * @param random         RNG returning [0, 1); injected so tests can pin the draw
 * @throws if `stats` is empty — the caller must enable at least one domain
 */
export function pickSubskill(
  stats: readonly SubskillStat[],
  lastServedKey: string | null,
  now: Date,
  random: () => number = Math.random
): string {
  if (stats.length === 0) {
    throw new Error("pickSubskill called with no enabled subskills.");
  }

  const candidates =
    stats.length > 1 ? stats.filter((s) => s.subskillKey !== lastServedKey) : stats;
  const pool = candidates.length > 0 ? candidates : stats;

  const weights = pool.map((stat) => selectionWeight(stat, now));
  const total = weights.reduce((sum, w) => sum + w, 0);

  // Defensive: weights are strictly positive by construction (the 1.05 ceiling
  // guarantees it), but a non-finite total would silently break the draw below.
  if (!Number.isFinite(total) || total <= 0) {
    return pool[Math.floor(random() * pool.length)].subskillKey;
  }

  let threshold = random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    threshold -= weights[i];
    if (threshold <= 0) {
      return pool[i].subskillKey;
    }
  }

  // Floating-point remainder: fall through to the last candidate.
  return pool[pool.length - 1].subskillKey;
}

// --- Difficulty ladder ------------------------------------------------------

/**
 * Chooses the difficulty for the next question in a subskill.
 *
 * Uses rolling accuracy over the last DIFFICULTY_WINDOW attempts rather than
 * lifetime accuracy, so improvement moves the ladder within a session instead of
 * being diluted by week-one performance.
 *
 * In simulation mode the ladder is bypassed entirely and everything is hard —
 * that is the point of test-day simulation.
 *
 * @param recentAttempts attempts for THIS subskill, most-recent-first
 * @param simMode        test-day simulation: forces hard, ignores the ladder
 */
export function pickDifficulty(
  recentAttempts: readonly AttemptRecord[],
  simMode: boolean
): Difficulty {
  if (simMode) return "hard";

  const window = recentAttempts.slice(0, DIFFICULTY_WINDOW);

  // Not enough evidence yet — start in the middle rather than guessing.
  if (window.length < MIN_ATTEMPTS_FOR_LADDER) return "medium";

  const correct = window.filter((a) => a.wasCorrect).length;
  const accuracy = correct / window.length;

  if (accuracy >= HARD_THRESHOLD) return "hard";
  if (accuracy >= MEDIUM_THRESHOLD) return "medium";
  return "easy";
}

// --- Helpers for the bank warmer -------------------------------------------

/**
 * The `count` highest-weight subskills, strongest candidates first.
 *
 * Used to decide which (subskill, difficulty) cells to pre-generate questions for,
 * so the question bank is warm where the next draw is most likely to land.
 */
export function topWeightedSubskills(
  stats: readonly SubskillStat[],
  now: Date,
  count: number
): string[] {
  return [...stats]
    .map((stat) => ({ key: stat.subskillKey, weight: selectionWeight(stat, now) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count)
    .map((entry) => entry.key);
}

/**
 * Builds a zeroed stat row for a subskill with no history yet.
 * Keeps "never attempted" and "attempted zero times" as the same thing everywhere.
 */
export function emptyStat(subskillKey: string): SubskillStat {
  return { subskillKey, correctCount: 0, totalCount: 0, lastAttemptedAt: null };
}
