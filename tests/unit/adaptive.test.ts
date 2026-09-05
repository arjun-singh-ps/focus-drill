// Tests for the adaptive engine. These exist because the selection weighting is the
// one part of the app whose misbehaviour is invisible from the outside — a slightly
// wrong exponent still "works", it just quietly drills the wrong things for a month.

import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_WINDOW,
  emptyStat,
  isColdStart,
  pickDifficulty,
  pickSubskill,
  rawAccuracy,
  selectionWeight,
  smoothedAccuracy,
  topWeightedSubskills,
  type AttemptRecord,
  type SubskillStat,
} from "@/lib/adaptive";

const NOW = new Date("2026-09-05T12:00:00.000Z");

/** Builds a stat row with a given accuracy over a given number of attempts. */
function stat(
  key: string,
  accuracy: number,
  total: number,
  lastAttemptedAt: string | null = NOW.toISOString()
): SubskillStat {
  return {
    subskillKey: key,
    correctCount: Math.round(accuracy * total),
    totalCount: total,
    lastAttemptedAt,
  };
}

/** A deterministic RNG cycling through the supplied values. */
function seededRandom(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("smoothedAccuracy", () => {
  it("scores an untried subskill at exactly 0.5", () => {
    expect(smoothedAccuracy(emptyStat("x"))).toBe(0.5);
  });

  it("pulls a single correct answer well below 100%", () => {
    // Without smoothing this would be 1.0 and the subskill would nearly vanish.
    expect(smoothedAccuracy(stat("x", 1, 1))).toBeCloseTo(2 / 3, 5);
  });

  it("converges on raw accuracy as attempts accumulate", () => {
    expect(smoothedAccuracy(stat("x", 0.8, 100))).toBeCloseTo(0.794, 2);
  });
});

describe("rawAccuracy", () => {
  it("returns null rather than NaN when there are no attempts", () => {
    expect(rawAccuracy(emptyStat("x"))).toBeNull();
  });

  it("returns the plain ratio once there are attempts", () => {
    expect(rawAccuracy(stat("x", 0.5, 10))).toBe(0.5);
  });
});

describe("selectionWeight", () => {
  it("weights a weak subskill far above a strong one", () => {
    const weak = selectionWeight(stat("weak", 0.4, 20), NOW);
    const strong = selectionWeight(stat("strong", 0.85, 20), NOW);
    // The design target is roughly 10:1. Assert a band, not an exact figure, so
    // the test documents intent rather than pinning an incidental constant.
    expect(weak / strong).toBeGreaterThan(6);
    expect(weak / strong).toBeLessThan(16);
  });

  it("never drops a fully mastered subskill to zero weight", () => {
    // This is what the 1.05 ceiling buys: 100% accuracy still gets rotation.
    const mastered = selectionWeight(stat("mastered", 1, 50), NOW);
    expect(mastered).toBeGreaterThan(0);
  });

  it("boosts a subskill that has not been attempted enough yet", () => {
    // total: 2 rather than 1 — at total 1, stat()'s Math.round(0.5 * 1) rounds up
    // to a 1/1 (100%) stat rather than a true 50%, which would compare the wrong
    // thing. At total 2, 0.5 * 2 = 1 divides exactly.
    const cold = selectionWeight(stat("cold", 0.5, 2), NOW);
    const warm = selectionWeight(stat("warm", 0.5, 20), NOW);
    expect(cold).toBeGreaterThan(warm);
  });

  it("boosts a subskill untouched for three days or more", () => {
    const stale = new Date(NOW.getTime() - 4 * 86_400_000).toISOString();
    const staleStat = selectionWeight(stat("s", 0.7, 20, stale), NOW);
    const freshStat = selectionWeight(stat("f", 0.7, 20), NOW);
    expect(staleStat / freshStat).toBeCloseTo(1.25, 5);
  });

  it("does not stack the stale boost onto a never-attempted subskill", () => {
    // lastAttemptedAt === null must not read as "infinitely stale". total: 2, for
    // the same rounding reason as above — total 1 would compare a 100% stat
    // against a 50% one instead of two matched 50% stats.
    const never = selectionWeight(emptyStat("n"), NOW);
    const coldButAttempted = selectionWeight(stat("c", 0.5, 2), NOW);
    expect(never).toBeCloseTo(coldButAttempted, 5);
  });
});

describe("pickSubskill", () => {
  it("throws rather than silently doing nothing when no domains are enabled", () => {
    expect(() => pickSubskill([], null, NOW)).toThrow(/no enabled subskills/i);
  });

  it("serves the weak subskill roughly ten times more often than the strong one", () => {
    const stats = [stat("weak", 0.4, 20), stat("strong", 0.85, 20)];
    const counts: Record<string, number> = { weak: 0, strong: 0 };

    // No lastServedKey, so the no-repeat rule does not distort the distribution.
    for (let i = 0; i < 10_000; i += 1) {
      counts[pickSubskill(stats, null, NOW)] += 1;
    }

    const ratio = counts.weak / counts.strong;
    expect(ratio).toBeGreaterThan(6);
    expect(ratio).toBeLessThan(16);
  });

  it("still reaches a 100%-accuracy subskill over a long run", () => {
    const stats = [stat("mastered", 1, 50), stat("weak", 0.3, 50)];
    let masteredSeen = 0;
    for (let i = 0; i < 5_000; i += 1) {
      if (pickSubskill(stats, null, NOW) === "mastered") masteredSeen += 1;
    }
    expect(masteredSeen).toBeGreaterThan(0);
  });

  it("never serves the same subskill twice in a row when alternatives exist", () => {
    const stats = [stat("a", 0.5, 10), stat("b", 0.5, 10), stat("c", 0.5, 10)];
    let last: string | null = null;
    for (let i = 0; i < 500; i += 1) {
      const next = pickSubskill(stats, last, NOW);
      expect(next).not.toBe(last);
      last = next;
    }
  });

  it("yields the no-repeat rule when only one subskill is enabled", () => {
    const stats = [stat("only", 0.5, 10)];
    expect(pickSubskill(stats, "only", NOW)).toBe("only");
  });

  it("respects the injected RNG deterministically", () => {
    const stats = [stat("a", 0.5, 10), stat("b", 0.5, 10)];
    // Equal weights, so a draw just below the midpoint must land on the first.
    expect(pickSubskill(stats, null, NOW, seededRandom([0.1]))).toBe("a");
    expect(pickSubskill(stats, null, NOW, seededRandom([0.9]))).toBe("b");
  });
});

describe("pickDifficulty", () => {
  /** Builds `n` attempts, the first `correct` of them right. Most-recent-first order. */
  function attempts(correct: number, n: number): AttemptRecord[] {
    return Array.from({ length: n }, (_, i) => ({
      subskillKey: "x",
      wasCorrect: i < correct,
    }));
  }

  it("starts at medium with no history", () => {
    expect(pickDifficulty([], false)).toBe("medium");
  });

  it("stays at medium until there are three attempts", () => {
    expect(pickDifficulty(attempts(0, 2), false)).toBe("medium");
  });

  it("climbs to hard at 80% rolling accuracy", () => {
    expect(pickDifficulty(attempts(4, 5), false)).toBe("hard");
  });

  it("holds at medium between 50% and 80%", () => {
    expect(pickDifficulty(attempts(3, 5), false)).toBe("medium");
  });

  it("drops to easy below 50%", () => {
    expect(pickDifficulty(attempts(2, 5), false)).toBe("easy");
  });

  it("moves easy to medium to hard as accuracy improves", () => {
    expect(pickDifficulty(attempts(1, 5), false)).toBe("easy");
    expect(pickDifficulty(attempts(3, 5), false)).toBe("medium");
    expect(pickDifficulty(attempts(5, 5), false)).toBe("hard");
  });

  it("only looks at the most recent window, ignoring older history", () => {
    // Five recent correct answers, then a long tail of failures that must not count.
    const recent = [...attempts(DIFFICULTY_WINDOW, DIFFICULTY_WINDOW), ...attempts(0, 50)];
    expect(pickDifficulty(recent, false)).toBe("hard");
  });

  it("forces hard in simulation mode regardless of accuracy", () => {
    expect(pickDifficulty(attempts(0, 20), true)).toBe("hard");
    expect(pickDifficulty([], true)).toBe("hard");
  });
});

describe("topWeightedSubskills", () => {
  it("returns the weakest subskills first", () => {
    const stats = [stat("strong", 0.9, 20), stat("weak", 0.3, 20), stat("mid", 0.6, 20)];
    expect(topWeightedSubskills(stats, NOW, 2)).toEqual(["weak", "mid"]);
  });

  it("caps the result at the requested count", () => {
    const stats = [stat("a", 0.5, 10), stat("b", 0.5, 10), stat("c", 0.5, 10)];
    expect(topWeightedSubskills(stats, NOW, 2)).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const stats = [stat("a", 0.9, 10), stat("b", 0.1, 10)];
    topWeightedSubskills(stats, NOW, 2);
    expect(stats[0].subskillKey).toBe("a");
  });
});

describe("isColdStart", () => {
  it("is true when every subskill has zero attempts", () => {
    expect(isColdStart([emptyStat("a"), emptyStat("b"), emptyStat("c")])).toBe(true);
  });

  it("is false once even one subskill has an attempt", () => {
    const stats = [emptyStat("a"), stat("b", 1, 1), emptyStat("c")];
    expect(isColdStart(stats)).toBe(false);
  });

  it("is false once every subskill has attempts", () => {
    const stats = [stat("a", 0.5, 4), stat("b", 0.5, 4)];
    expect(isColdStart(stats)).toBe(false);
  });

  it("is vacuously true for an empty list", () => {
    // Never actually reached in practice — pickSubskill throws on empty stats
    // before this predicate would matter — but Array.prototype.every on an
    // empty array is true by definition, and the test documents that on purpose
    // rather than leaving it as an unconsidered edge case.
    expect(isColdStart([])).toBe(true);
  });
});
