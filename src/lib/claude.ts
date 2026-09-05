// Server-only Claude API client. Never import this from a "use client" file —
// it reads ANTHROPIC_API_KEY, which must never reach the browser bundle.
//
// This is the whole reason the app exists as a server app rather than the original
// artifact prototype: the prototype called api.anthropic.com straight from the
// browser with no key, which only works inside the Claude.ai artifact sandbox.

import Anthropic from "@anthropic-ai/sdk";

/**
 * Opus 5 is used deliberately. A wrong answer key on a hard Advanced Math question
 * does not just waste a question — it teaches the wrong method and then the
 * adaptive weighting over-drills a subskill she actually knows. At a 1530+ target
 * that is the expensive failure, not the API bill.
 */
export const CLAUDE_MODEL = "claude-opus-5";

let client: Anthropic | null = null;

/** Returns the singleton Anthropic client, shared by the question generator. */
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
  }

  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return client;
}
