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

/**
 * Built-in defaults — the last rung of the precedence ladder:
 * CLI flag > drafter.json (injected via registerFlags as the registered
 * default) > these. Keep in sync with registerFlags below.
 */
const DEFAULTS = {
  enabled: true,
  model: "",
  contextTurns: 3,
  trigger: "always",
  thresholdChars: 120,
  autoAccept: "off",
  logPath: "",
} as const;

/** Reads a registered flag as a boolean with a fallback. */
function flagBool(pi: { getFlag(name: string): boolean | string | undefined }, name: string, fallback: boolean): boolean {
  const v = pi.getFlag(name);
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1" || v === "on";
  return fallback;
}

export function getConfig(pi: { getFlag(name: string): boolean | string | undefined }): DrafterConfig {
  const trigger = flagStr(pi, "drafter-trigger", DEFAULTS.trigger);
  const autoAccept = flagStr(pi, "drafter-auto-accept", DEFAULTS.autoAccept);
  return {
    enabled: flagBool(pi, "drafter-enabled", DEFAULTS.enabled),
    model: flagStr(pi, "drafter-model", DEFAULTS.model),
    contextTurns: Math.max(0, Number(flagStr(pi, "drafter-context-turns", String(DEFAULTS.contextTurns))) || DEFAULTS.contextTurns),
    trigger: trigger === "command" || trigger === "threshold" ? trigger : "always",
    thresholdChars: Math.max(0, Number(flagStr(pi, "drafter-threshold-chars", String(DEFAULTS.thresholdChars))) || DEFAULTS.thresholdChars),
    autoAccept: autoAccept === "when_no_assumptions" ? "when_no_assumptions" : "off",
    logPath: flagStr(pi, "drafter-log-path", DEFAULTS.logPath),
  };
}

/**
 * Registers all flags. Kept next to getConfig so names/defaults stay in sync.
 *
 * `fileValues` (normalized values from ~/.pi/agent/drafter.json, keyed by the
 * canonical DrafterConfig field names) ride in as the *registered default*:
 * Pi applies CLI values over registered defaults after load, so the effective
 * precedence is CLI > drafter.json > built-in, with no changes to getConfig.
 */
export function registerFlags(
  pi: {
    registerFlag(name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string }): void;
  },
  fileValues: Record<string, string | boolean> = {},
): void {
  pi.registerFlag("drafter-enabled", {
    description: "Master switch for the response-drafter extension",
    type: "boolean",
    default: fileValues.enabled ?? DEFAULTS.enabled,
  });
  pi.registerFlag("drafter-model", {
    description: "Drafter model as 'provider/id' or bare 'id'. Empty = use the main session model",
    type: "string",
    default: fileValues.model ?? DEFAULTS.model,
  });
  pi.registerFlag("drafter-context-turns", {
    description: "How many prior user-delimited turns of transcript to feed the drafter",
    type: "string",
    default: fileValues.contextTurns ?? String(DEFAULTS.contextTurns),
  });
  pi.registerFlag("drafter-trigger", {
    description: "When the drafter runs: always | threshold | command",
    type: "string",
    default: fileValues.trigger ?? DEFAULTS.trigger,
  });
  pi.registerFlag("drafter-threshold-chars", {
    description: "With trigger=threshold, auto-draft inputs longer than this many characters",
    type: "string",
    default: fileValues.thresholdChars ?? String(DEFAULTS.thresholdChars),
  });
  pi.registerFlag("drafter-auto-accept", {
    description: "Auto-accept policy: off | when_no_assumptions",
    type: "string",
    default: fileValues.autoAccept ?? DEFAULTS.autoAccept,
  });
  pi.registerFlag("drafter-log-path", {
    description: "Optional JSONL path for draft/accept/edit telemetry (spec §13)",
    type: "string",
    default: fileValues.logPath ?? DEFAULTS.logPath,
  });
}
