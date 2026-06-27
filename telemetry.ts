/**
 * Telemetry (spec §13) — the self-check that tells you whether the extension is
 * net-positive: when a drafted prompt "worked better," was the added content
 * compression of knowledge you had but didn't type (the win), or invention that
 * happened to be right (a coin flip)? Logging mode + assumptions + action lets
 * you review accepted drafts whose assumptions were non-empty after the fact.
 */

import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { DraftMode } from "./schema";

export type CycleAction = "accept" | "edit" | "reject" | "fallback" | "cancel";

export interface CycleRecord {
  ts: string;
  terse_input: string;
  transcript_hash: string;
  mode: DraftMode | "none";
  drafted_prompt: string;
  assumptions: string[];
  action: CycleAction;
  edited_to: string | null;
}

export function hashTranscript(transcript: string): string {
  return createHash("sha256").update(transcript).digest("hex").slice(0, 16);
}

export interface CycleInput {
  terseInput: string;
  transcriptText: string;
  mode: DraftMode | "none";
  draftedPrompt: string;
  assumptions: string[];
  action: CycleAction;
  editedTo: string | null;
}

export function buildRecord(input: CycleInput): CycleRecord {
  return {
    ts: new Date().toISOString(),
    terse_input: input.terseInput,
    transcript_hash: hashTranscript(input.transcriptText),
    mode: input.mode,
    drafted_prompt: input.draftedPrompt,
    assumptions: input.assumptions,
    action: input.action,
    edited_to: input.editedTo,
  };
}

/**
 * Persist a cycle. Always appends a session entry (visible to /export, not sent
 * to the LLM); additionally appends JSONL to `logPath` when configured. Logging
 * never throws into the caller — a telemetry failure must not break the loop.
 */
export async function logCycle(
  pi: { appendEntry: <T>(customType: string, data?: T) => void },
  logPath: string,
  input: CycleInput,
): Promise<void> {
  const record = buildRecord(input);
  try {
    pi.appendEntry("drafter:cycle", record);
  } catch {
    // session entry failed; still try the file log below
  }
  if (logPath) {
    try {
      await appendFile(logPath, JSON.stringify(record) + "\n", "utf8");
    } catch {
      // best-effort file logging
    }
  }
}
