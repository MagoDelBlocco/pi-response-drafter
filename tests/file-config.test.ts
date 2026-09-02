import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFileConfig } from "../file-config.ts";

test("reads canonical camelCase keys", () => {
  const { values, errors } = parseFileConfig(JSON.stringify({
    model: "anthropic/claude-haiku-4-5",
    enabled: false,
    contextTurns: 5,
    trigger: "command",
    thresholdChars: 200,
    autoAccept: "when_no_assumptions",
    logPath: "/tmp/drafts.jsonl",
  }));
  assert.deepEqual(errors, []);
  assert.equal(values.model, "anthropic/claude-haiku-4-5");
  assert.equal(values.enabled, false);
  assert.equal(values.contextTurns, "5");
  assert.equal(values.trigger, "command");
  assert.equal(values.thresholdChars, "200");
  assert.equal(values.autoAccept, "when_no_assumptions");
  assert.equal(values.logPath, "/tmp/drafts.jsonl");
});

test("accepts drafter- prefixed and kebab/snake spellings", () => {
  const { values, errors } = parseFileConfig(JSON.stringify({
    "drafter-model": "x/y",
    "context-turns": 4,
    "threshold_chars": 50,
    "auto-accept": "off",
    "log-path": "/tmp/a.jsonl",
  }));
  assert.deepEqual(errors, []);
  assert.equal(values.model, "x/y");
  assert.equal(values.contextTurns, "4");
  assert.equal(values.thresholdChars, "50");
  assert.equal(values.autoAccept, "off");
  assert.equal(values.logPath, "/tmp/a.jsonl");
});

test("string and numeric booleans coerce for enabled", () => {
  assert.equal(parseFileConfig('{"enabled": true}').values.enabled, true);
  assert.equal(parseFileConfig('{"enabled": "off"}').values.enabled, false);
  assert.equal(parseFileConfig('{"enabled": "1"}').values.enabled, true);
  assert.equal(parseFileConfig('{"enabled": "FALSE"}').values.enabled, false);
});

test("invalid enum or numeric values are dropped with an error, valid keys survive", () => {
  const { values, errors } = parseFileConfig(JSON.stringify({
    model: "keep/me",
    trigger: "sometimes",
    contextTurns: -2,
    thresholdChars: "abc",
  }));
  assert.equal(values.model, "keep/me");
  assert.equal(values.trigger, undefined);
  assert.equal(values.contextTurns, undefined);
  assert.equal(values.thresholdChars, undefined);
  assert.equal(errors.length, 3);
});

test("unknown keys are reported but not fatal", () => {
  const { values, errors } = parseFileConfig('{"model": "a/b", "color": "blue"}');
  assert.equal(values.model, "a/b");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /color/);
});

test("malformed JSON or non-object yields errors and no values", () => {
  const bad = parseFileConfig("{oops");
  assert.deepEqual(bad.values, {});
  assert.equal(bad.errors.length, 1);
  const arr = parseFileConfig("[1,2]");
  assert.deepEqual(arr.values, {});
  assert.equal(arr.errors.length, 1);
});
