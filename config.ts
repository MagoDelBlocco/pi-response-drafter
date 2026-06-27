/**
 * Configuration, resolved from Pi CLI flags (spec §11).
 *
 * Pi flags are string/boolean only, so numeric values are coerced here. Drafting
 * is enabled and triggered automatically by default so it runs on ordinary input
 * without requiring an explicit `/draft` invocation.
 */

export type TriggerMode = "command" | "always" | "threshold";
export type AutoAccept = "off" | "when_no_assumptions";

export interface DrafterConfig {
  /** Global on/off. When false, /draft passes input straight through. */
  enabled: boolean;
  /**
   * Model id for the drafter. Format: "provider/id" or bare "id" (first match
   * across providers). Empty string => use the main session model.
   */
  model: string;
  /** How many prior user-delimited turns of transcript to feed (spec §8). */
  contextTurns: number;
  /** When the drafter runs (spec §15.1). Default: always (every non-empty input). */
  trigger: TriggerMode;
  /** Input length (chars) above which `trigger: "threshold"` auto-drafts. */
  thresholdChars: number;
  /** Auto-accept policy (spec §11, §15.2). Default off. */
  autoAccept: AutoAccept;
  /** Optional path for the §13 telemetry log (JSONL). Empty => session entries only. */
  logPath: string;
}

/** Reads a registered flag as a string with a fallback. */
function flagStr(pi: { getFlag(name: string): boolean | string | undefined }, name: string, fallback: string): string {
  const v = pi.getFlag(name);
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Reads a registered flag as a boolean with a fallback. */
function flagBool(pi: { getFlag(name: string): boolean | string | undefined }, name: string, fallback: boolean): boolean {
  const v = pi.getFlag(name);
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1" || v === "on";
  return fallback;
}

export function getConfig(pi: { getFlag(name: string): boolean | string | undefined }): DrafterConfig {
  const trigger = flagStr(pi, "drafter-trigger", "always");
  const autoAccept = flagStr(pi, "drafter-auto-accept", "off");
  return {
    enabled: flagBool(pi, "drafter-enabled", true),
    model: flagStr(pi, "drafter-model", ""),
    contextTurns: Math.max(0, Number(flagStr(pi, "drafter-context-turns", "3")) || 3),
    trigger: trigger === "always" || trigger === "threshold" ? trigger : "always",
    thresholdChars: Math.max(0, Number(flagStr(pi, "drafter-threshold-chars", "120")) || 120),
    autoAccept: autoAccept === "when_no_assumptions" ? "when_no_assumptions" : "off",
    logPath: flagStr(pi, "drafter-log-path", ""),
  };
}

/** Registers all flags. Kept next to getConfig so names/defaults stay in sync. */
export function registerFlags(pi: {
  registerFlag(name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string }): void;
}): void {
  pi.registerFlag("drafter-enabled", {
    description: "Master switch for the response-drafter extension",
    type: "boolean",
    default: true,
  });
  pi.registerFlag("drafter-model", {
    description: "Drafter model as 'provider/id' or bare 'id'. Empty = use the main session model",
    type: "string",
    default: "",
  });
  pi.registerFlag("drafter-context-turns", {
    description: "How many prior user-delimited turns of transcript to feed the drafter",
    type: "string",
    default: "3",
  });
  pi.registerFlag("drafter-trigger", {
    description: "When the drafter runs: always | threshold | command",
    type: "string",
    default: "always",
  });
  pi.registerFlag("drafter-threshold-chars", {
    description: "With trigger=threshold, auto-draft inputs longer than this many characters",
    type: "string",
    default: "120",
  });
  pi.registerFlag("drafter-auto-accept", {
    description: "Auto-accept policy: off | when_no_assumptions",
    type: "string",
    default: "off",
  });
  pi.registerFlag("drafter-log-path", {
    description: "Optional JSONL path for draft/accept/edit telemetry (spec §13)",
    type: "string",
    default: "",
  });
}
