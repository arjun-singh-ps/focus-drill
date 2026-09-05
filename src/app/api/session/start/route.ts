// POST /api/session/start — warm the question bank before a practice run begins.
//
// Called when she presses Start. Fills the bank for the cells most likely to come
// up, so the first several questions are instant. This one call is allowed to be
// slow (it shows a "getting your questions ready" state); every call after it is not.

import { NextResponse } from "next/server";
import {
  loadSelectionContext,
  warmCells,
  WARM_TARGET_DEPTH,
} from "@/lib/nextQuestion";
import { topUpBank } from "@/lib/questionBank";
import { getRateLimitStatus } from "@/lib/rateLimit";

/** Vercel's default function timeout is short; warming several questions needs longer. */
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

    const cells = await warmCells(context);
    const { added, rateLimited } = await topUpBank(cells, WARM_TARGET_DEPTH);
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
