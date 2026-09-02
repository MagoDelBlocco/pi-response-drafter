/**
 * File-based configuration: `~/.pi/agent/drafter.json`.
 *
 * CLI flags are per-invocation and nothing in Pi persists extension flags, so
 * this file is the permanent home for drafter settings. It is read ONCE at
 * extension load time (same doctrine as prompt.md); edits need `/reload` or a
 * session restart.
 *
 * Precedence: CLI flag > this file > built-in default. The mechanism is the
 * registered flag default — {@link registerFlags} uses a file value as the
 * default when the file supplies one, and Pi's runtime overwrites registered
 * defaults with CLI values after load.
 *
 * Schema (all keys optional; canonical camelCase, with `drafter-` prefix and
 * kebab/snake spellings accepted):
 *   model, enabled, contextTurns, trigger, thresholdChars, autoAccept, logPath
 *
 * Invalid values are dropped with a per-key error; valid siblings survive.
 * Pure parsing lives here (no fs at import time beyond explicit calls) so the
 * logic is unit-testable per repo convention.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Parsed file: normalized values (flag-ready strings/booleans) + human-readable errors. */
export interface FileConfig {
  values: Record<string, string | boolean>;
  errors: string[];
}

/** Where the scroll lives. Overridable for tests; production takes the default. */
export function defaultConfigPath(): string {
  return join(homedir(), ".pi", "agent", "drafter.json");
}

const CANONICAL_KEYS = ["enabled", "model", "contextTurns", "trigger", "thresholdChars", "autoAccept", "logPath"] as const;
type CanonicalKey = (typeof CANONICAL_KEYS)[number];

/** Flat (case- and separator-insensitive) key lookup: context-turns / context_turns / contextTurns all land on contextTurns. */
const KEYS_BY_FLAT: Record<string, CanonicalKey> = Object.fromEntries(
  CANONICAL_KEYS.map((k) => [k.toLowerCase(), k]),
);

function normalizeKey(raw: string): CanonicalKey | undefined {
  const flat = raw.trim().toLowerCase().replace(/[_-]/g, "").replace(/^drafter/, "");
  return KEYS_BY_FLAT[flat];
}

function coerceBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "on") return true;
    if (s === "false" || s === "0" || s === "off") return false;
  }
  return undefined;
}

function coerceString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function coerceCount(v: unknown): string | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
}

function coerceEnum(...allowed: readonly string[]) {
  return (v: unknown): string | undefined =>
    typeof v === "string" && allowed.includes(v.trim()) ? v.trim() : undefined;
}

/** One coercion rule per canonical key; a dropped value becomes a per-key error. */
const COERCIONS: Record<CanonicalKey, (v: unknown) => string | boolean | undefined> = {
  enabled: coerceBool,
  model: coerceString,
  contextTurns: coerceCount,
  trigger: coerceEnum("command", "always", "threshold"),
  thresholdChars: coerceCount,
  autoAccept: coerceEnum("off", "when_no_assumptions"),
  logPath: coerceString,
};

/** Parses the JSON body of drafter.json. Never throws; problems land in `errors`. */
export function parseFileConfig(json: string): FileConfig {
  const values: Record<string, string | boolean> = {};
  const errors: string[] = [];

  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (err) {
    return { values, errors: [`drafter.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { values, errors: ["drafter.json must contain a JSON object"] };
  }

  for (const [rawKey, raw] of Object.entries(doc as Record<string, unknown>)) {
    const key = normalizeKey(rawKey);
    if (!key) {
      errors.push(`drafter.json: unknown key "${rawKey}" (ignored)`);
      continue;
    }
    const value = COERCIONS[key](raw);
    if (value === undefined) {
      errors.push(`drafter.json: invalid value for "${rawKey}": ${JSON.stringify(raw)} (ignored)`);
      continue;
    }
    values[key] = value;
  }
  return { values, errors };
}

/** Reads and parses the scroll. Absent file is success with empty values (maintains current logic). */
export function loadFileConfig(path: string = defaultConfigPath()): FileConfig {
  if (!existsSync(path)) return { values: {}, errors: [] };
  try {
    return parseFileConfig(readFileSync(path, "utf8"));
  } catch (err) {
    return { values: {}, errors: [`drafter.json could not be read: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
