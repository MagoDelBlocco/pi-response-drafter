import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecord, hashTranscript, logCycle } from "../telemetry.ts";

test("hashTranscript is stable and short", () => {
  const h1 = hashTranscript("abc");
  const h2 = hashTranscript("abc");
  assert.equal(h1, h2);
  assert.equal(h1.length, 16);
  assert.notEqual(h1, hashTranscript("abd"));
});

test("buildRecord captures the spec §13 fields", () => {
  const r = buildRecord({
    terseInput: "fix auth",
    transcriptText: "[user] fix auth",
    mode: "continuation",
    draftedPrompt: "Investigate why auth fails and fix it.",
    assumptions: ["assumed JWT"],
    action: "accept",
    editedTo: null,
  });
  assert.equal(r.terse_input, "fix auth");
  assert.equal(r.mode, "continuation");
  assert.equal(r.action, "accept");
  assert.deepEqual(r.assumptions, ["assumed JWT"]);
  assert.equal(r.edited_to, null);
  assert.equal(typeof r.ts, "string");
  assert.equal(r.transcript_hash, hashTranscript("[user] fix auth"));
});

test("logCycle appends a session entry and never throws", async () => {
  const entries: Array<{ type: string; data: unknown }> = [];
  const pi = { appendEntry: <T>(customType: string, data?: T) => { entries.push({ type: customType, data }); } };
  await logCycle(pi, "", {
    terseInput: "x",
    transcriptText: "t",
    mode: "new_direction",
    draftedPrompt: "p",
    assumptions: [],
    action: "reject",
    editedTo: null,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "drafter:cycle");
});

test("logCycle swallows appendEntry failures", async () => {
  const pi = { appendEntry: () => { throw new Error("boom"); } };
  await assert.doesNotReject(
    logCycle(pi, "", {
      terseInput: "x", transcriptText: "t", mode: "none",
      draftedPrompt: "", assumptions: [], action: "fallback", editedTo: null,
    }),
  );
});
