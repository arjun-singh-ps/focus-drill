// POST /api/next-question — the main practice loop endpoint.
//
// Runs the adaptive selection server-side, serves a question from the bank (never
// the answer key), then tops the bank back up in the background so the NEXT call
// is instant too.

import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import {
  chooseCell,
  loadSelectionContext,
  obtainQuestion,
  toServedQuestion,
  warmCells,
  WARM_TARGET_DEPTH,
} from "@/lib/nextQuestion";
import { topUpBank } from "@/lib/questionBank";
import { RateLimitExceededError } from "@/lib/rateLimit";

export async function POST() {
  try {
    const context = await loadSelectionContext();

    if (context.stats.length === 0) {
      return NextResponse.json(
        { error: "No practice domains are enabled. Turn at least one on in Settings." },
        { status: 400 }
      );
    }

    const cell = await chooseCell(context);
    const banked = await obtainQuestion(cell);

    // Background top-up. waitUntil keeps the serverless function alive past the
    // response, so she is not waiting on generation she will not use for 90 seconds.
    waitUntil(
      warmCells(context)
        .then((cells) => topUpBank(cells, WARM_TARGET_DEPTH))
        .catch((error) => {
          console.error(
            "Background bank top-up failed:",
            error instanceof Error ? error.message : error
          );
        })
    );

    return NextResponse.json({
      question: toServedQuestion(banked),
      settings: context.settings,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    console.error(
      "Could not serve a question:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Could not load a question. Try again in a moment." },
      { status: 502 }
    );
  }
}
