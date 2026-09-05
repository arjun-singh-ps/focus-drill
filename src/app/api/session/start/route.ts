// POST /api/session/start — warm the question bank before a practice run begins.
//
// Called when she presses Start. Fills the bank for the cells most likely to come
// up, so the first several questions are instant. This one call is allowed to be
// slow (it shows a "getting your questions ready" state); every call after it is not.

import { NextResponse } from "next/server";
import {
  COLD_START_TARGET_DEPTH,
  isColdStart,
  loadSelectionContext,
  warmCells,
  WARM_TARGET_DEPTH,
} from "@/lib/nextQuestion";
import { topUpBank } from "@/lib/questionBank";
import { getRateLimitStatus } from "@/lib/rateLimit";

/**
 * Only takes effect if this ever runs on Vercel again — Next.js ignores route
 * config a deployment target doesn't support, so it's harmless here. On Cloud
 * Run the equivalent is the service's own request timeout, set at deploy time
 * with `gcloud run deploy --timeout=300` (see README) — Cloud Run's default is
 * already 300s, matching this value.
 */
export const maxDuration = 300;

export async function POST() {
  try {
    const context = await loadSelectionContext();

    if (context.stats.length === 0) {
      return NextResponse.json(
        { error: "No practice domains are enabled. Turn at least one on in Settings." },
        { status: 400 }
      );
    }

    // At true cold start every subskill is tied (no accuracy data yet), so the
    // real draw in pickSubskill is effectively uniform across all of them —
    // warming only the top few would still miss most first-questions. Warm the
    // whole enabled rotation once, shallowly; every session after the first
    // logged attempt reverts to the narrower, deeper top-N warm below.
    const cold = isColdStart(context.stats);
    const cells = cold
      ? await warmCells(context, context.stats.length)
      : await warmCells(context);
    const targetDepth = cold ? COLD_START_TARGET_DEPTH : WARM_TARGET_DEPTH;

    const { added, rateLimited } = await topUpBank(cells, targetDepth);
    const rateLimit = await getRateLimitStatus();

    return NextResponse.json({
      ready: true,
      added,
      rateLimited,
      remaining: rateLimit.remaining,
      settings: context.settings,
    });
  } catch (error) {
    console.error(
      "Could not start the session:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Could not get questions ready. Try again in a moment." },
      { status: 502 }
    );
  }
}
