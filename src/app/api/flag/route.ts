// POST /api/flag — report a broken question.
//
// AI-generated questions occasionally carry a wrong answer key or an ambiguous
// stem. Flagging voids the attempt: it stops counting against her accuracy, so one
// bad item cannot make the adaptive weighting over-drill a subskill she is fine at.

import { NextResponse } from "next/server";
import { flagAttempt } from "@/lib/stats";

export async function POST(request: Request) {
  let attemptId: unknown;

  try {
    const body = await request.json();
    attemptId = (body as { attemptId?: unknown })?.attemptId;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof attemptId !== "string" || attemptId.length === 0) {
    return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
  }

  try {
    // False means it was already flagged. That is not an error — a double-tap
    // should be a no-op, not a second reversal of the stats.
    const changed = await flagAttempt(attemptId);
    return NextResponse.json({ ok: true, changed });
  } catch (error) {
    console.error(
      "Could not flag the attempt:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Could not flag that question." }, { status: 502 });
  }
}
