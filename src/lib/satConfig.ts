// The digital SAT's domain and subskill taxonomy — the single source of truth for
// this app. The adaptive algorithm, the question generator prompt, the practice UI
// and the progress dashboard all read from here, so a subskill only ever has to be
// added or renamed in one place.
//
// The subskills follow College Board's published "skill/knowledge testing points"
// for the digital SAT. The three domains marked defaultOn are the ones flagged as
// weak spots for this user: Algebra, Advanced Math, and Information and Ideas.

/** Which of the two digital SAT sections a domain belongs to. Drives timer pacing. */
export type Section = "math" | "rw";

/** The three difficulty rungs the adaptive ladder moves between. */
export type Difficulty = "easy" | "medium" | "hard";

/** A single testable skill — the unit the adaptive algorithm selects and scores. */
export interface Subskill {
  key: string;
  label: string;
}

/** A College Board content domain, containing several subskills. */
export interface Domain {
  key: string;
  label: string;
  section: Section;
  /** Enabled out of the box. The three known weak domains for this user. */
  defaultOn: boolean;
  subskills: Subskill[];
}

/**
 * Real digital SAT module pacing, used as the per-question timer budget.
 *
 * Math: 22 questions in 35 minutes  = 95.5s per question.
 * Reading and Writing: 27 in 32 min = 71.1s per question.
 *
 * These are averages across a module, not a per-question rule the real test
 * enforces — but drilling at the average is what builds the pacing instinct.
 */
export const SECONDS_PER_QUESTION: Record<Section, number> = {
  math: 95,
  rw: 71,
};

export const DOMAINS: Domain[] = [
  {
    key: "algebra",
    label: "Algebra",
    section: "math",
    defaultOn: true,
    subskills: [
      { key: "linear-equations-one-variable", label: "Linear equations in one variable" },
      { key: "linear-equations-two-variables", label: "Linear equations in two variables" },
      { key: "linear-functions", label: "Linear functions" },
      { key: "systems-linear-equations", label: "Systems of two linear equations" },
      { key: "linear-inequalities", label: "Linear inequalities" },
    ],
  },
  {
    key: "advanced-math",
    label: "Advanced Math",
    section: "math",
    defaultOn: true,
    subskills: [
      { key: "equivalent-expressions", label: "Equivalent expressions" },
      { key: "nonlinear-equations-systems", label: "Nonlinear equations and systems" },
      { key: "nonlinear-functions", label: "Nonlinear functions" },
    ],
  },
  {
    key: "problem-solving-data-analysis",
    label: "Problem-Solving and Data Analysis",
    section: "math",
    defaultOn: false,
    subskills: [
      { key: "ratios-rates-proportions-units", label: "Ratios, rates, proportions and units" },
      { key: "percentages", label: "Percentages" },
      { key: "one-variable-data", label: "One-variable data: distributions and measures" },
      { key: "two-variable-data", label: "Two-variable data: models and scatterplots" },
      { key: "probability", label: "Probability and conditional probability" },
      { key: "inference-margin-of-error", label: "Inference from samples and margin of error" },
      { key: "evaluating-statistical-claims", label: "Evaluating statistical claims" },
    ],
  },
  {
    key: "geometry-trigonometry",
    label: "Geometry and Trigonometry",
    section: "math",
    defaultOn: false,
    subskills: [
      { key: "area-and-volume", label: "Area and volume" },
      { key: "lines-angles-triangles", label: "Lines, angles and triangles" },
      { key: "right-triangles-trigonometry", label: "Right triangles and trigonometry" },
      { key: "circles", label: "Circles" },
    ],
  },
  {
    key: "information-and-ideas",
    label: "Information and Ideas",
    section: "rw",
    defaultOn: true,
    subskills: [
      { key: "central-ideas-and-details", label: "Central ideas and details" },
      { key: "command-of-evidence-textual", label: "Command of evidence (textual)" },
      { key: "command-of-evidence-quantitative", label: "Command of evidence (quantitative)" },
      { key: "inferences", label: "Inferences" },
    ],
  },
  {
    key: "craft-and-structure",
    label: "Craft and Structure",
    section: "rw",
    defaultOn: false,
    subskills: [
      { key: "words-in-context", label: "Words in context" },
      { key: "text-structure-and-purpose", label: "Text structure and purpose" },
      { key: "cross-text-connections", label: "Cross-text connections" },
    ],
  },
  {
    key: "expression-of-ideas",
    label: "Expression of Ideas",
    section: "rw",
    defaultOn: false,
    subskills: [
      { key: "rhetorical-synthesis", label: "Rhetorical synthesis" },
      { key: "transitions", label: "Transitions" },
    ],
  },
  {
    key: "standard-english-conventions",
    label: "Standard English Conventions",
    section: "rw",
    defaultOn: false,
    subskills: [
      { key: "boundaries", label: "Boundaries" },
      { key: "form-structure-and-sense", label: "Form, structure and sense" },
    ],
  },
];

/** Every domain key that is enabled unless the user says otherwise. */
export const DEFAULT_ENABLED_DOMAINS: string[] = DOMAINS.filter((d) => d.defaultOn).map(
  (d) => d.key
);

/**
 * Flat lookup from subskill key to its subskill, parent domain and section.
 * Built once at module load so hot paths never re-scan the DOMAINS tree.
 */
const SUBSKILL_INDEX: ReadonlyMap<string, { subskill: Subskill; domain: Domain }> = new Map(
  DOMAINS.flatMap((domain) =>
    domain.subskills.map(
      (subskill) => [subskill.key, { subskill, domain }] as const
    )
  )
);

/** All subskill keys across every domain, enabled or not. */
export const ALL_SUBSKILL_KEYS: string[] = [...SUBSKILL_INDEX.keys()];

/**
 * Looks up a subskill by key.
 *
 * @throws if the key is unknown — an unknown key means stored data has drifted
 * from this config, which must fail loudly rather than silently mis-score.
 */
export function getSubskill(key: string): { subskill: Subskill; domain: Domain } {
  const found = SUBSKILL_INDEX.get(key);
  if (!found) {
    throw new Error(`Unknown subskill key: "${key}". Check src/lib/satConfig.ts.`);
  }
  return found;
}

/** Returns true if the key exists in this config. Use before getSubskill on untrusted input. */
export function isKnownSubskill(key: string): boolean {
  return SUBSKILL_INDEX.has(key);
}

/** The section a subskill belongs to, via its parent domain. */
export function sectionForSubskill(key: string): Section {
  return getSubskill(key).domain.section;
}

/** The per-question timer budget in seconds for a subskill, from its section's pacing. */
export function secondsForSubskill(key: string): number {
  return SECONDS_PER_QUESTION[sectionForSubskill(key)];
}

/** Every subskill key belonging to the given enabled domain keys. */
export function subskillKeysForDomains(domainKeys: readonly string[]): string[] {
  const enabled = new Set(domainKeys);
  return DOMAINS.filter((d) => enabled.has(d.key)).flatMap((d) =>
    d.subskills.map((s) => s.key)
  );
}
