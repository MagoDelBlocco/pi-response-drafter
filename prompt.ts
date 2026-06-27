/**
 * Drafter prompt construction (spec §6).
 *
 * The system contract is the anti-fabrication core. It is non-negotiable: the
 * drafter may only use what's in the transcript or the user's input, must route
 * anything inferred into `assumptions`, and must ask rather than guess when intent
 * is ambiguous and the transcript doesn't resolve it.
 */

export const SYSTEM_CONTRACT = `You are a prompt drafter for a coding agent. Your ONLY job is to rewrite the
user's intent into a single, well-formed prompt that the coding agent will act on.
You are NOT predicting intent and you are NOT doing the coding task — you are
articulating, more clearly, what the user already means.

HARD RULES (these are the entire reason you exist — violating them is worse than
returning a vague prompt):
- Use ONLY information present in the transcript or the user's input.
- Do NOT introduce facts, diagnoses, root causes, file names, function names,
  error messages, or requirements that are not present in those sources.
- If you infer or add ANYTHING not explicitly stated by the user or transcript,
  it goes in "assumptions" as a separate item. Never weave an inference into the
  prompt as if it were a given fact.
- Preserve the user's epistemic state. If they don't know the cause of a bug, the
  prompt must ask the agent to INVESTIGATE the cause, not assert one.
- If the user's intent is ambiguous AND the transcript does not resolve it, set
  mode to "question" and return specific questions instead of guessing.

MODE:
- "continuation": the transcript clearly constrains the next step. Reconstruct the
  next instruction from what the agent just did, skipped, or failed.
- "new_direction": the user introduces a step the transcript is silent on.
  Elaborate ONLY the user's input; use the transcript for style/context, NOT as a
  source of new content. Scrutinize your assumptions harder here.
- "question": intent is ambiguous and the transcript doesn't resolve it.

OUTPUT: strict JSON only, no prose outside it, matching exactly:
{
  "mode": "continuation" | "new_direction" | "question",
  "prompt": "string (empty when mode is question)",
  "assumptions": ["each inferred or added element not stated by user or transcript"],
  "questions": ["populated only when mode is question"]
}`;

export interface DraftPromptInput {
  /** The user's terse input. May be empty (an explicit /draft on empty input). */
  userInput: string;
  /** Assembled transcript slice; empty for a fresh session. */
  transcriptText: string;
  /** Prior clarifying Q&A accumulated across re-draft rounds (spec §7, §9). */
  clarifications: Array<{ question: string; answer: string }>;
}

export function buildDraftPrompt(input: DraftPromptInput): string {
  const transcript = input.transcriptText
    ? input.transcriptText
    : "(no transcript — this is a fresh session or transcript context is disabled)";

  const userInput = input.userInput.trim()
    ? input.userInput.trim()
    : "(the user invoked the drafter on EMPTY input — they want the next prompt reconstructed from the transcript)";

  const clarifications =
    input.clarifications.length > 0
      ? input.clarifications.map((c, i) => `Q${i + 1}: ${c.question}\nA${i + 1}: ${c.answer}`).join("\n")
      : "(none)";

  return `<transcript>
${transcript}
</transcript>

<user_input>
${userInput}
</user_input>

<clarifications>
${clarifications}
</clarifications>

Draft the next prompt now. Remember: anything not present above goes in
"assumptions", and if you cannot resolve the intent from these sources, ask.
Respond with the JSON object only.`;
}
