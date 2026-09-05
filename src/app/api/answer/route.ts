// POST /api/answer — grade an answer, log it, and reveal the key.
//
// Grading happens here rather than in the browser so the answer key never reaches
// the client, and so the log is written from what the server knows rather than
// from whatever the browser claims happened.

import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { loadSettings, recordAttempt } from "@/lib/stats";
import type { AnswerRequest, AnswerResponse, QuestionPayload } from "@/types";
import type { Difficulty } from "@/lib/satConfig";

export async function POST(request: Request) {
  let body: Partial<AnswerRequest>;

  try {
    body = (await request.json()) as Partial<AnswerRequest>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { questionId, choiceIndex, timedOut, secondsTaken } = body;

  if (typeof questionId !== "string" || questionId.length === 0) {
    return NextResponse.json({ error: "questionId is required." }, { status: 400 });
  }

  if (typeof timedOut !== "boolean") {
    return NextResponse.json({ error: "timedOut is required." }, { status: 400 });
  }

  // A real selection must be 0-3. Null is only valid when the clock ran out.
  const hasChoice = typeof choiceIndex === "number";
  if (hasChoice && (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3)) {
    return NextResponse.json({ error: "choiceIndex must be 0-3." }, { status: 400 });
  }
  if (!hasChoice && !timedOut) {
    return NextResponse.json(
      { error: "An answer needs a choiceIndex unless it timed out." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServiceClient();

    const { data: question, error } = await supabase
      .from("question_bank")
      .select("id, subskill_key, difficulty, payload")
      .eq("id", questionId)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not load the question: ${error.message}`);
    }

    if (!question) {
      return NextResponse.json({ error: "That question no longer exists." }, { status: 404 });
    }

    const payload = question.payload as QuestionPayload;
    const settings = await loadSettings();

    // A timeout is scored as incorrect, per the practice design — but was_timed_out
    // is logged separately so /progress can tell "did not know it" from "too slow".
    const wasCorrect = !timedOut && hasChoice && choiceIndex === payload.correctIndex;

    const attemptId = await recordAttempt({
      subskillKey: question.subskill_key as string,
      difficulty: question.difficulty as Difficulty,
      wasCorrect,
      wasTimedOut: timedOut,
      simMode: settings.simMode,
      timerEnabled: settings.timerEnabled,
      secondsTaken: Math.max(0, Math.round(Number(secondsTaken) || 0)),
      questionId,
    });

    const result: AnswerResponse = {
      attemptId,
      correct: wasCorrect,
      correctIndex: payload.correctIndex,
      explanation: payload.explanation,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "Could not grade the answer:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Could not save that answer. Try again." },
      { status: 502 }
    );
  }
}
