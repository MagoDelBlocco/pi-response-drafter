/**
 * The drafter's structured output.
 *
 * This module is intentionally free of runtime dependencies so it can be unit
 * tested in isolation. The actual model call lives in llm.ts.
 *
 * The schema is the safety surface of the whole extension (spec §6): `assumptions`
 * is where the drafter must declare anything it inferred or added that was not
 * stated by the user or present in the transcript. An empty array is a contract:
 * "I added nothing you didn't give me." A non-empty array is exactly what lazy
 * review must look at — and the only place a fabrication can legitimately appear.
 */

export type DraftMode = "continuation" | "new_direction" | "question";

export interface DraftResult {
  /** Which grounding regime the drafter believes it is in (spec §4, §9). */
  mode: DraftMode;
  /** The rewritten prompt for the main agent. Empty when mode === "question". */
  prompt: string;
  /** Each inferred/added element NOT stated by the user or transcript (spec §6). */
  assumptions: string[];
  /** Specific questions back to the user. Populated only when mode === "question". */
  questions: string[];
}

/**
 * The safe fallback draft. Used when the model returns unparseable output: rather
 * than invent, we degrade to a question with no prompt and no assumptions, which
 * the caller treats as "couldn't draft — fall back to raw input" (spec §15.4).
 */
export function emptyDraft(): DraftResult {
  return { mode: "question", prompt: "", assumptions: [], questions: [] };
}

/** Coerce an unknown value to a clean string array (drops non-strings, trims, drops empties). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Parse the model's text response into a DraftResult.
 *
 * Tolerates code fences and surrounding prose by extracting the first JSON object.
 * Missing/!valid fields fall back to safe defaults so consumers can always iterate
 * the array fields and switch on a known mode.
 */
export function parseDraft(content: string): DraftResult {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return emptyDraft();

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return emptyDraft();
  }

  const mode: DraftMode =
    raw.mode === "continuation" || raw.mode === "new_direction" || raw.mode === "question"
      ? raw.mode
      : "question";

  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const assumptions = toStringArray(raw.assumptions);
  const questions = toStringArray(raw.questions);

  // A "question" with no questions is useless; an answerable draft with no prompt
  // is also useless. In either degenerate case, fall back to the empty draft so
  // the caller takes the safe raw-input path instead of injecting nothing.
  if (mode === "question" && questions.length === 0) return emptyDraft();
  if (mode !== "question" && prompt.length === 0) return emptyDraft();

  return { mode, prompt, assumptions, questions };
}
