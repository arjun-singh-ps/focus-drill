// Ties the adaptive engine to the database: decide what to serve, then serve it.
//
// Sits between the pure logic in adaptive.ts and the route handlers, so both
// /api/next-question and /api/session/start can share the "which cells matter most
// right now" decision without duplicating it.

import {
  DIFFICULTY_WINDOW,
  pickDifficulty,
  pickSubskill,
  topWeightedSubskills,
  type SubskillStat,
} from "./adaptive";
import {
  claimQuestion,
  generateIntoBank,
  takeFromBank,
  type BankedQuestion,
} from "./questionBank";
import { getSubskill, secondsForSubskill, type Difficulty } from "./satConfig";
import {
  lastServedSubskill,
  loadSettings,
  loadStatsForDomains,
  recentAttemptsForSubskill,
} from "./stats";
import type { AppSettings, ServedQuestion } from "@/types";

/** A (subskill, difficulty) pair — the unit the bank is stocked by. */
export interface Cell {
  subskillKey: string;
  difficulty: Difficulty;
}

/** How many cells ahead the bank is kept warm. */
export const WARM_CELL_COUNT = 3;

/** Target unserved questions per warm cell. */
export const WARM_TARGET_DEPTH = 2;

/** Everything the caller needs to pick and serve, loaded in one go. */
export interface SelectionContext {
  settings: AppSettings;
  stats: SubskillStat[];
  lastServed: string | null;
}

/** Loads settings, stats and the last-served key together. */
export async function loadSelectionContext(): Promise<SelectionContext> {
  const settings = await loadSettings();
  const [stats, lastServed] = await Promise.all([
    loadStatsForDomains(settings.enabledDomains),
    lastServedSubskill(),
  ]);
  return { settings, stats, lastServed };
}

/**
 * Chooses the next (subskill, difficulty) to serve.
 *
 * Selection is weighted towards weak subskills (adaptive.ts §pickSubskill) and the
 * difficulty comes from that subskill's own recent form — except in simulation
 * mode, where everything is hard.
 */
export async function chooseCell(context: SelectionContext): Promise<Cell> {
  const subskillKey = pickSubskill(context.stats, context.lastServed, new Date());
  const recent = await recentAttemptsForSubskill(subskillKey, DIFFICULTY_WINDOW);
  const difficulty = pickDifficulty(recent, context.settings.simMode);
  return { subskillKey, difficulty };
}

/**
 * The cells most likely to be needed next, for pre-generating into the bank.
 *
 * Uses the same weighting as real selection, so the bank is warm exactly where the
 * next draw is most likely to land rather than spread thinly across everything.
 */
export async function warmCells(context: SelectionContext): Promise<Cell[]> {
  const keys = topWeightedSubskills(context.stats, new Date(), WARM_CELL_COUNT);

  return Promise.all(
    keys.map(async (subskillKey) => {
      const recent = await recentAttemptsForSubskill(subskillKey, DIFFICULTY_WINDOW);
      return {
        subskillKey,
        difficulty: pickDifficulty(recent, context.settings.simMode),
      };
    })
  );
}

/**
 * Gets a question for a cell: from the bank if one is waiting, otherwise generated
 * inline.
 *
 * The inline path is the slow one (20-40s) and exists only as a correctness
 * fallback — if it fires often, the bank is not being topped up and that is the
 * thing to fix, not this function.
 *
 * A duplicate-rejected generation returns null from generateIntoBank, so retry
 * once before giving up.
 */
export async function obtainQuestion(cell: Cell): Promise<BankedQuestion> {
  const banked = await takeFromBank(cell.subskillKey, cell.difficulty);
  if (banked) return banked;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generated = await generateIntoBank(cell.subskillKey, cell.difficulty);
    if (generated) {
      // Claim this exact question, not "whatever is next in the bank" — otherwise
      // the one we just generated stays unserved and can be handed out again later.
      await claimQuestion(generated.id);
      return generated;
    }
  }

  throw new Error(
    `Could not obtain a question for ${cell.subskillKey}/${cell.difficulty} — ` +
      `two generations in a row were rejected as duplicates.`
  );
}

/**
 * Strips the answer key and adds the display metadata the UI needs.
 *
 * This is the boundary where correctIndex and explanation stop travelling — they
 * are only revealed by /api/answer, after she has committed to a choice.
 */
export function toServedQuestion(banked: BankedQuestion): ServedQuestion {
  const { subskill, domain } = getSubskill(banked.subskillKey);

  return {
    questionId: banked.id,
    subskillKey: banked.subskillKey,
    subskillLabel: subskill.label,
    domainLabel: domain.label,
    section: domain.section,
    difficulty: banked.difficulty,
    ...(banked.payload.passage ? { passage: banked.payload.passage } : {}),
    stem: banked.payload.stem,
    choices: banked.payload.choices,
    secondsAllowed: secondsForSubskill(banked.subskillKey),
  };
}
