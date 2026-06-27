import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraft, emptyDraft } from "../schema.ts";

test("parses a clean continuation draft", () => {
  const r = parseDraft(JSON.stringify({
    mode: "continuation",
    prompt: "Handle the empty-input case in parseArgs.",
    assumptions: [],
    questions: [],
  }));
  assert.equal(r.mode, "continuation");
  assert.equal(r.prompt, "Handle the empty-input case in parseArgs.");
  assert.deepEqual(r.assumptions, []);
});

test("extracts JSON from surrounding prose and code fences", () => {
  const text = "Sure!\n```json\n{\"mode\":\"new_direction\",\"prompt\":\"Add a --verbose flag.\",\"assumptions\":[\"flag name is --verbose\"],\"questions\":[]}\n```\nHope that helps.";
  const r = parseDraft(text);
  assert.equal(r.mode, "new_direction");
  assert.equal(r.prompt, "Add a --verbose flag.");
  assert.deepEqual(r.assumptions, ["flag name is --verbose"]);
});

test("keeps question mode with questions", () => {
  const r = parseDraft(JSON.stringify({ mode: "question", prompt: "", assumptions: [], questions: ["Which auth flow?"] }));
  assert.equal(r.mode, "question");
  assert.deepEqual(r.questions, ["Which auth flow?"]);
});

test("falls back to emptyDraft on unparseable output", () => {
  assert.deepEqual(parseDraft("no json here"), emptyDraft());
});

test("question mode with no questions degrades to emptyDraft (fallback signal)", () => {
  const r = parseDraft(JSON.stringify({ mode: "question", prompt: "", assumptions: [], questions: [] }));
  assert.deepEqual(r, emptyDraft());
});

test("non-question mode with empty prompt degrades to emptyDraft", () => {
  const r = parseDraft(JSON.stringify({ mode: "continuation", prompt: "   ", assumptions: ["x"], questions: [] }));
  assert.deepEqual(r, emptyDraft());
});

test("coerces malformed arrays and unknown mode", () => {
  const r = parseDraft(JSON.stringify({
    mode: "banana",
    prompt: "do the thing",
    assumptions: ["ok", 42, "", "  trimmed  "],
    questions: "not an array",
  }));
  // unknown mode -> question; but no questions -> emptyDraft
  assert.deepEqual(r, emptyDraft());
});

test("trims and drops empty assumption entries on a valid draft", () => {
  const r = parseDraft(JSON.stringify({
    mode: "continuation",
    prompt: "p",
    assumptions: ["  a  ", "", "b"],
    questions: [],
  }));
  assert.deepEqual(r.assumptions, ["a", "b"]);
});
