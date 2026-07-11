/**
 * Drafter prompt construction (spec §6).
 *
 * The system contract is the anti-fabrication core. It is non-negotiable: the
 * drafter may only use what's in the transcript or the user's input, must route
 * anything inferred into `assumptions`, and must ask rather than guess when intent
 * is ambiguous and the transcript doesn't resolve it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The anti-fabrication system contract, loaded from the editable prompt.md
 * sitting next to this module. Read once at load time so edits take effect on
 * the next extension start.
 */
export const SYSTEM_CONTRACT = readFileSync(
  fileURLToPath(new URL("./prompt.md", import.meta.url)),
  "utf8",
).trim();

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
