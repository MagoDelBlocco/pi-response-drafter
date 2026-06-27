import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAutoSubcommand } from "../commands.ts";

test("recognizes the bare toggle", () => {
  assert.equal(parseAutoSubcommand("auto"), "toggle");
  assert.equal(parseAutoSubcommand("  AUTO  "), "toggle");
});

test("recognizes explicit on/off", () => {
  assert.equal(parseAutoSubcommand("auto on"), "on");
  assert.equal(parseAutoSubcommand("auto enable"), "on");
  assert.equal(parseAutoSubcommand("auto off"), "off");
  assert.equal(parseAutoSubcommand("auto  disable"), "off");
});

test("treats ordinary draft input as not-a-subcommand", () => {
  assert.equal(parseAutoSubcommand("fix the auth thing"), null);
  assert.equal(parseAutoSubcommand("automate the build"), null);
  assert.equal(parseAutoSubcommand(""), null);
  assert.equal(parseAutoSubcommand("auto the deployment"), null);
});
