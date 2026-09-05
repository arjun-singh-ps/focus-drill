// Generates a single SAT question for a (subskill, difficulty) cell.
//
// Uses structured outputs so the response is schema-valid JSON rather than prose we
// have to hope parses — a malformed question in a timed drill is worse than a slow
// one. Adaptive thinking at high effort is on because correctness of the answer key
// is the entire value here; effort is where that is bought.

import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getClient } from "./claude";
import { getSubskill, type Difficulty } from "./satConfig";
import type { QuestionPayload } from "@/types";

/** JSON schema the model must fill. `strict`-style: no extra keys, everything required. */
const QUESTION_SCHEMA = {
  type: "object" as const,
  properties: {
    passage: {
      type: "string",
      description:
        "The reading passage or quantitative stimulus. Required for Reading and Writing " +
        "questions and for any maths question that references data. Omit for pure maths.",
    },
    stem: {
      type: "string",
      description: "The question itself, as it would appear on the digital SAT.",
    },
    choices: {
      type: "array",
      items: { type: "string" },
      minItems: 4,
      maxItems: 4,
      description: "Exactly four answer options, without A/B/C/D labels.",
    },
    correctIndex: {
      type: "integer",
      minimum: 0,
      maximum: 3,
      description: "Zero-based index of the correct option in `choices`.",
    },
    explanation: {
      type: "string",
      description:
        "Why the correct answer is correct AND why the most tempting wrong answer is " +
        "wrong. Two to four sentences, addressed to the student.",
    },
  },
  required: ["stem", "choices", "correctIndex", "explanation"],
  additionalProperties: false,
};

/** How the three difficulty rungs should actually differ, in the model's terms. */
const DIFFICULTY_GUIDANCE: Record<Difficulty, string> = {
  easy:
    "Easy: one conceptual step, clean numbers, the method is obvious once the student " +
    "recognises the topic. Roughly the first third of an SAT module.",
  medium:
    "Medium: two steps, or one step plus a translation from words into maths. The " +
    "student must choose the method, not just execute it.",
  hard:
    "Hard: three or more steps, or an unfamiliar framing of a familiar idea. This should " +
    "be the kind of question that separates a 700 from a 780 — genuinely demanding, but " +
    "solvable inside the time limit with no tricks or ambiguity.",
};

const SYSTEM_PROMPT = `You write practice questions for the digital SAT for a strong student targeting 1530+.

Rules that matter more than anything else:
1. The answer key must be correct. Work the problem fully before committing to correctIndex.
2. Exactly one option may be defensible. If two options could be argued, rewrite the question.
3. Distractors must be the results of specific, plausible mistakes — a sign error, a
   misread of the question, an off-by-one, the right work stopped one step early. Never
   use filler or obviously absurd options.
4. Match the real digital SAT in register, length and format. Maths stems are terse.
   Reading passages run 25-150 words and are drawn from science, social science,
   humanities or literature.
5. Use plain text. Write maths inline in a readable form (x^2, sqrt(5), <=, pi, 3/4).
   No LaTeX, no markdown, no images, no "refer to the figure".
6. The explanation teaches the method, it does not merely restate the answer.

You will be told the subskill, the domain and the difficulty. Produce one question that
tests that subskill specifically — not a neighbouring one.`;

/** Options for a single generation call. */
export interface GenerateOptions {
  subskillKey: string;
  difficulty: Difficulty;
  /** Recent stems for this subskill, so the model can avoid repeating itself. */
  avoidStems?: readonly string[];
}

/**
 * Generates one question. Throws on API failure or on a response that fails
 * validation — the caller decides whether to retry or surface the error.
 */
export async function generateQuestion(
  options: GenerateOptions
): Promise<QuestionPayload> {
  const { subskill, domain } = getSubskill(options.subskillKey);

  const avoidBlock =
    options.avoidStems && options.avoidStems.length > 0
      ? `\n\nDo not reproduce or lightly reword any of these recently used questions:\n` +
        options.avoidStems.map((stem, i) => `${i + 1}. ${stem}`).join("\n")
      : "";

  const userPrompt =
    `Section: ${domain.section === "math" ? "Math" : "Reading and Writing"}\n` +
    `Domain: ${domain.label}\n` +
    `Subskill: ${subskill.label}\n` +
    `Difficulty: ${options.difficulty}\n\n` +
    `${DIFFICULTY_GUIDANCE[options.difficulty]}` +
    avoidBlock;

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: QUESTION_SCHEMA },
    },
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Question generation refused for ${options.subskillKey}: ${
        response.stop_details?.explanation ?? "no explanation given"
      }`
    );
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text.trim()) {
    throw new Error(`Question generation returned no text for ${options.subskillKey}.`);
  }

  return parseAndValidate(text, options.subskillKey);
}

/**
 * Parses the model's JSON and enforces the invariants the schema cannot express.
 *
 * Structured outputs guarantee the shape, not the sense — this catches duplicate
 * options and blank fields, which would otherwise become an unanswerable question
 * mid-drill.
 */
function parseAndValidate(text: string, subskillKey: string): QuestionPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Question generation returned invalid JSON for ${subskillKey}.`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Question generation returned a non-object for ${subskillKey}.`);
  }

  const candidate = parsed as Record<string, unknown>;
  const { stem, choices, correctIndex, explanation, passage } = candidate;

  if (typeof stem !== "string" || stem.trim().length === 0) {
    throw new Error(`Generated question for ${subskillKey} has an empty stem.`);
  }

  if (!Array.isArray(choices) || choices.length !== 4) {
    throw new Error(`Generated question for ${subskillKey} does not have four choices.`);
  }

  if (!choices.every((c): c is string => typeof c === "string" && c.trim().length > 0)) {
    throw new Error(`Generated question for ${subskillKey} has a blank choice.`);
  }

  const normalised = choices.map((c) => c.trim().toLowerCase());
  if (new Set(normalised).size !== 4) {
    throw new Error(`Generated question for ${subskillKey} has duplicate choices.`);
  }

  if (
    typeof correctIndex !== "number" ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex > 3
  ) {
    throw new Error(`Generated question for ${subskillKey} has an out-of-range answer key.`);
  }

  if (typeof explanation !== "string" || explanation.trim().length === 0) {
    throw new Error(`Generated question for ${subskillKey} has an empty explanation.`);
  }

  return {
    ...(typeof passage === "string" && passage.trim().length > 0
      ? { passage: passage.trim() }
      : {}),
    stem: stem.trim(),
    choices: [choices[0], choices[1], choices[2], choices[3]] as [
      string,
      string,
      string,
      string,
    ],
    correctIndex: correctIndex as 0 | 1 | 2 | 3,
    explanation: explanation.trim(),
  };
}

/**
 * A stable fingerprint of a question stem, used to reject near-duplicates.
 *
 * Normalises whitespace, case and punctuation first so trivial rewording of the
 * same question still collides. Uses FNV-1a: fast, no dependency, and collision
 * resistance is irrelevant here — a false collision just discards one question.
 */
export function stemHash(stem: string): string {
  const normalised = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  let hash = 0x811c9dc5;
  for (let i = 0; i < normalised.length; i += 1) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
