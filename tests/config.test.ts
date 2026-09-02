import { test } from "node:test";
import assert from "node:assert/strict";
import { getConfig, registerFlags } from "../config.ts";

function piWith(flags: Record<string, string | boolean | undefined>) {
  return { getFlag: (name: string) => flags[name] };
}

test("defaults are opt-in and lossless", () => {
  const c = getConfig(piWith({}));
  assert.equal(c.enabled, true);
  assert.equal(c.model, "");
  assert.equal(c.contextTurns, 3);
  assert.equal(c.trigger, "always");
  assert.equal(c.autoAccept, "off");
  assert.equal(c.logPath, "");
});

test("coerces numeric and enum flags", () => {
  const c = getConfig(piWith({
    "drafter-context-turns": "5",
    "drafter-trigger": "threshold",
    "drafter-threshold-chars": "200",
    "drafter-auto-accept": "when_no_assumptions",
  }));
  assert.equal(c.contextTurns, 5);
  assert.equal(c.trigger, "threshold");
  assert.equal(c.thresholdChars, 200);
  assert.equal(c.autoAccept, "when_no_assumptions");
});

test("invalid enum values fall back to safe defaults", () => {
  const c = getConfig(piWith({ "drafter-trigger": "bogus", "drafter-auto-accept": "yes-please" }));
  assert.equal(c.trigger, "always");
  assert.equal(c.autoAccept, "off");
});

test("enabled accepts boolean and string forms", () => {
  assert.equal(getConfig(piWith({ "drafter-enabled": false })).enabled, false);
  assert.equal(getConfig(piWith({ "drafter-enabled": "false" })).enabled, false);
  assert.equal(getConfig(piWith({ "drafter-enabled": "on" })).enabled, true);
});

test("file values become the registered flag defaults; silent keys keep built-ins", () => {
  const registered: Record<string, { type: string; default?: boolean | string }> = {};
  registerFlags(
    { registerFlag: (name, opts) => { registered[name] = opts; } },
    { model: "anthropic/claude-haiku-4-5", enabled: false },
  );
  assert.equal(registered["drafter-model"].default, "anthropic/claude-haiku-4-5");
  assert.equal(registered["drafter-enabled"].default, false);
  // Keys the file says nothing about keep the built-in defaults.
  assert.equal(registered["drafter-trigger"].default, "always");
  assert.equal(registered["drafter-context-turns"].default, "3");
});

test("precedence: CLI flag beats file default beats built-in", () => {
  const registered: Record<string, { type: string; default?: boolean | string }> = {};
  registerFlags(
    { registerFlag: (name, opts) => { registered[name] = opts; } },
    { contextTurns: "7", trigger: "command" },
  );
  // Mirror Pi's runtime: getFlag returns the CLI value when one was passed,
  // otherwise the registered default (which the file may have supplied).
  const cliValues = { "drafter-context-turns": "9" };
  const getFlag = (name: string) =>
    name in cliValues ? cliValues[name as keyof typeof cliValues] : registered[name]?.default;
  const c = getConfig({ getFlag });
  assert.equal(c.contextTurns, 9); // CLI wins
  assert.equal(c.trigger, "command"); // file beats built-in
  assert.equal(c.thresholdChars, 120); // built-in when both silent
});
