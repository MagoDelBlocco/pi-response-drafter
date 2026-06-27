import { test } from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../config.ts";

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
