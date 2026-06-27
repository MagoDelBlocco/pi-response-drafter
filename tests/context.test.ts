import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleContext } from "../context.ts";

function userMsg(text: string) {
  return { type: "message", message: { role: "user", content: text } };
}
function asstMsg(text: string) {
  return { type: "message", message: { role: "assistant", content: [{ type: "text", text }] } };
}
function toolCall(name: string, input: unknown) {
  return { type: "tool_call", toolName: name, input };
}
function toolResult(name: string, content: string) {
  return { type: "tool_result", toolName: name, content };
}

test("returns empty for no entries or zero turns", () => {
  assert.equal(assembleContext([], 3).transcriptText, "");
  assert.equal(assembleContext([userMsg("hi")], 0).transcriptText, "");
});

test("windows to the last N user-delimited turns", () => {
  const entries = [
    userMsg("turn 1"), asstMsg("did 1"),
    userMsg("turn 2"), asstMsg("did 2"),
    userMsg("turn 3"), asstMsg("did 3"),
  ];
  const { transcriptText } = assembleContext(entries, 2);
  assert.ok(!transcriptText.includes("turn 1"), "older turn dropped");
  assert.ok(transcriptText.includes("turn 2"));
  assert.ok(transcriptText.includes("turn 3"));
  assert.ok(transcriptText.includes("[assistant] did 3"));
});

test("formats tool calls and results", () => {
  const entries = [
    userMsg("fix it"),
    toolCall("read", { path: "a.ts" }),
    toolResult("read", "file contents"),
    asstMsg("done"),
  ];
  const { transcriptText } = assembleContext(entries, 1);
  assert.ok(transcriptText.includes("[tool_call] read:"));
  assert.ok(transcriptText.includes("[tool_result] read: file contents"));
});

test("skips empty messages", () => {
  const entries = [userMsg("real"), asstMsg("")];
  const { transcriptText } = assembleContext(entries, 1);
  assert.ok(transcriptText.includes("[user] real"));
  assert.ok(!transcriptText.includes("[assistant]"));
});

test("truncates the front when over the char budget", () => {
  const big = "x".repeat(30000);
  const entries = [userMsg("start marker"), asstMsg(big), asstMsg("end marker")];
  const { transcriptText } = assembleContext(entries, 1);
  assert.ok(transcriptText.startsWith("...(earlier context truncated)..."));
  assert.ok(transcriptText.includes("end marker"));
});
