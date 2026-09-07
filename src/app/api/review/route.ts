// GET /api/review — one page of the attempted-question review list.
//
// Query params: outcome (all|correct|incorrect), subskill (a subskill key), offset,
// limit. Filtering happens server-side rather than loading everything and slicing
// in the browser, so the log can grow across a whole practice run without the page
// getting heavier over time.

import { NextResponse } from "next/server";
import { loadReviewPage } from "@/lib/review";
import { isKnownSubskill } from "@/lib/satConfig";
import type { ReviewOutcome } from "@/types";

const DEFAULT_LIMIT = 25;

function parseOutcome(value: string | null): ReviewOutcome {
  return value === "correct" || value === "incorrect" ? value : "all";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const outcome = parseOutcome(url.searchParams.get("outcome"));

  const subskillParam = url.searchParams.get("subskill");
  const subskillKey = subskillParam && isKnownSubskill(subskillParam) ? subskillParam : null;

  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT);

  try {
    const page = await loadReviewPage({ outcome, subskillKey, offset, limit });
    return NextResponse.json(page);
  } catch (error) {
    console.error(
      "Could not load the review page:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Could not load the review list." }, { status: 502 });
  }
}
