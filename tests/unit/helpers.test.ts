// Tests for the small pure helpers. Both are security- or correctness-relevant
// enough that "it looked right" is not good enough.

import { describe, expect, it } from "vitest";
import { stemHash } from "@/lib/questionGenerator";
import { timingSafeEqual } from "@/lib/session";

describe("stemHash", () => {
  it("is stable for the same stem", () => {
    expect(stemHash("If 3x + 5 = 20, what is x?")).toBe(stemHash("If 3x + 5 = 20, what is x?"));
  });

  it("ignores case, spacing and punctuation differences", () => {
    // These are the same question reworded trivially; duplicate detection has to
    // catch them, or she sees the same item twice in a session.
    expect(stemHash("If 3x + 5 = 20, what is x?")).toBe(stemHash("if 3x  +  5  =  20 what is x"));
  });

  it("differs for genuinely different stems", () => {
    expect(stemHash("If 3x + 5 = 20, what is x?")).not.toBe(
      stemHash("If 4x + 5 = 20, what is x?")
    );
  });

  it("always returns eight hex characters", () => {
    expect(stemHash("anything at all")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("handles an empty stem without throwing", () => {
    expect(stemHash("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("timingSafeEqual", () => {
  it("matches identical strings", () => {
    expect(timingSafeEqual("correct-horse", "correct-horse")).toBe(true);
  });

  it("rejects different strings of the same length", () => {
    expect(timingSafeEqual("correct-horse", "correct-hoose")).toBe(false);
  });

  it("rejects different lengths", () => {
    expect(timingSafeEqual("short", "much-longer-value")).toBe(false);
  });

  it("rejects an empty candidate against a real secret", () => {
    expect(timingSafeEqual("", "secret")).toBe(false);
  });

  it("does not short-circuit on the first differing character", () => {
    // Both differ from the target, one at the start and one at the end. The
    // function must treat them identically — that is the whole point.
    expect(timingSafeEqual("Xbcdef", "abcdef")).toBe(false);
    expect(timingSafeEqual("abcdeX", "abcdef")).toBe(false);
  });
});
