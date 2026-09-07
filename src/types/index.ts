// Shared types crossing the client/server boundary. Kept in one file so the shape
// of an API response is defined once and both ends import the same definition.

import type { Difficulty, Section } from "@/lib/satConfig";

/** A generated question exactly as it is stored in question_bank.payload. */
export interface QuestionPayload {
  /** Reading passages and quantitative stimuli. Absent for most maths questions. */
  passage?: string;
  stem: string;
  /** Always four options, matching the digital SAT's multiple-choice format. */
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
}

/**
 * A question as sent to the browser.
 *
 * Note what is NOT here: correctIndex and explanation. Grading happens server-side
 * in /api/answer, so the answer key never reaches the client and cannot be read
 * out of devtools or the network tab.
 */
export interface ServedQuestion {
  questionId: string;
  subskillKey: string;
  subskillLabel: string;
  domainLabel: string;
  section: Section;
  difficulty: Difficulty;
  passage?: string;
  stem: string;
  choices: [string, string, string, string];
  /** Timer budget for this question, from its section's real SAT pacing. */
  secondsAllowed: number;
}

/** What the client posts when submitting (or timing out on) an answer. */
export interface AnswerRequest {
  questionId: string;
  /** Null when the timer expired with nothing selected. */
  choiceIndex: number | null;
  timedOut: boolean;
  secondsTaken: number;
}

/** The graded result, including the answer key now that it is safe to reveal. */
export interface AnswerResponse {
  attemptId: string;
  correct: boolean;
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
}

/** Practice preferences, persisted in the single app_settings row. */
export interface AppSettings {
  enabledDomains: string[];
  simMode: boolean;
  timerEnabled: boolean;
}

/** One point on a subskill's accuracy trend line. */
export interface TrendPoint {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Rolling accuracy 0-1 at that date, or null on days with no attempts. */
  accuracy: number | null;
  attempts: number;
}

/** Everything the /progress dashboard needs, assembled server-side in one round trip. */
export interface ProgressData {
  /** Per-subskill accuracy over time. */
  trends: {
    subskillKey: string;
    subskillLabel: string;
    domainLabel: string;
    points: TrendPoint[];
    /** Current rolling accuracy, or null if never attempted. */
    currentAccuracy: number | null;
    totalAttempts: number;
  }[];
  /** Total questions attempted per calendar day. */
  dailyVolume: { date: string; attempts: number; correct: number }[];
  /** Timed attempts only: how often the clock, rather than the maths, was the problem. */
  timeoutBreakdown: {
    subskillKey: string;
    subskillLabel: string;
    timedAttempts: number;
    timeouts: number;
  }[];
  /** Questions she reported as broken, newest first. */
  flagged: {
    attemptId: string;
    createdAt: string;
    subskillLabel: string;
    difficulty: Difficulty;
    stem: string | null;
  }[];
  totals: {
    attempts: number;
    correct: number;
    flagged: number;
    activeDays: number;
  };
}

/** Which subset of the log /review shows. */
export type ReviewOutcome = "all" | "correct" | "incorrect";

/** What the client sends /api/review to request one page of results. */
export interface ReviewFilters {
  outcome: ReviewOutcome;
  /** Null means every subskill. */
  subskillKey: string | null;
  limit: number;
  offset: number;
}

/** One attempted question, in full — the question, what she picked, and the key. */
export interface ReviewItem {
  attemptId: string;
  createdAt: string;
  subskillKey: string;
  subskillLabel: string;
  domainLabel: string;
  difficulty: Difficulty;
  wasCorrect: boolean;
  wasTimedOut: boolean;
  /** Null only when it timed out with nothing selected. */
  chosenIndex: number | null;
  passage?: string;
  stem: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
}

/** One page of /api/review results. */
export interface ReviewPage {
  items: ReviewItem[];
  hasMore: boolean;
}
