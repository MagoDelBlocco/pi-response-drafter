import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAKE_CURSOR_START,
  LEGACY_CURSOR_BLOCK_START,
  normalizeSuggestion,
  renderGhostRows,
  wrapText,
  type TextMetrics,
} from "../ghost-render";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** pi-tui's hardware-cursor position marker (zero-width APC, focused only). */
const CURSOR_MARKER = "\x1b_pi:c\x07";
const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

// Escape-stripping width (like pi-tui's visibleWidth), otherwise ASCII length:
// the cursor markers must not count toward the cursor column.
const ascii: TextMetrics = {
  width: (s) => s.replace(/\x1b[^\x07]*\x07|\x1b\[[0-9;]*m/g, "").length,
  clip: (s, w) => s.slice(0, w),
};

// A base editor line with the cursor after "hello >>>" (cursor column = 9),
// spelled the way pi-tui's Editor renders it: zero-width markers around the
// grapheme drawn as the cursor.
const CURSOR_COL = "hello >>>".length;
function baseLines(): string[] {
  return [`hello >>>${FAKE_CURSOR_START} ${FAKE_CURSOR_END}`];
}

/** Ghost rows are everything spliced in after the single base (cursor) line. */
function ghostRows(rendered: string[]): string[] {
  return rendered.slice(1);
}

// ── normalizeSuggestion ──────────────────────────────────────────────────────

test("normalizeSuggestion strips leading and trailing blank lines", () => {
  assert.equal(normalizeSuggestion("\n\nFirst.\nSecond.\n\n\n"), "First.\nSecond.");
});

test("normalizeSuggestion preserves interior blank lines", () => {
  assert.equal(normalizeSuggestion("First block.\n\nSecond block."), "First block.\n\nSecond block.");
});

test("normalizeSuggestion returns null for empty or all-blank input", () => {
  assert.equal(normalizeSuggestion(null), null);
  assert.equal(normalizeSuggestion(""), null);
  assert.equal(normalizeSuggestion("\n  \n\t\n"), null);
});

// ── renderGhostRows ──────────────────────────────────────────────────────────

test("renders multi-line suggestions as separate appended ghost rows", () => {
  const rows = ghostRows(renderGhostRows(baseLines(), "Line one.\nLine two.\nLine three.", 120, ascii));

  assert.equal(rows.length, 3);
  assert.ok(rows[0].includes("Line one."));
  assert.ok(rows[1].includes("Line two."));
  assert.ok(rows[2].includes("Line three."));
  assert.ok(rows.every((l) => l.includes(DIM)));
});

test("drops blank lines within multi-line suggestions (no empty ghost rows)", () => {
  const rows = ghostRows(renderGhostRows(baseLines(), "First block.\n\nSecond block after blank line.", 120, ascii));

  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes("First block."));
  assert.ok(rows[1].includes("Second block after blank line."));
  assert.ok(rows.every((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim().length > 0));
});

test("indents ghost rows to the cursor column", () => {
  const rendered = renderGhostRows(baseLines(), "Suggested continuation.", 120, ascii);
  const row = rendered[rendered.length - 1];
  const leadingSpaces = row.slice(0, row.indexOf(DIM));

  assert.equal(leadingSpaces.length, CURSOR_COL);
});

test("wraps overly long suggestion lines onto subsequent ghost rows", () => {
  const longLine = "word ".repeat(50); // 250 chars, wraps at width 40
  const rows = ghostRows(renderGhostRows(baseLines(), longLine, 40, ascii));

  assert.ok(rows.length > 1, "long line should produce multiple ghost rows");
  for (const line of rows) {
    const visibleText = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
    assert.ok(visibleText.length <= 40 - CURSOR_COL, `wrapped line should fit remaining width: ${visibleText}`);
    assert.ok(!visibleText.endsWith("…"), "wrapped lines should not be ellipsized");
  }
});

test("returns base lines unchanged when no cursor marker is present", () => {
  const lines = ["no cursor here"];
  assert.deepEqual(renderGhostRows(lines, "Suggestion.", 120, ascii), lines);
});

test("anchors on the focused cursor: the hardware-cursor marker stays zero-width", () => {
  const lines = [`hello >>>${CURSOR_MARKER}${FAKE_CURSOR_START}w${FAKE_CURSOR_END}orld`];
  const rendered = renderGhostRows(lines, "Suggested continuation.", 120, ascii);
  const row = rendered[rendered.length - 1];

  assert.equal(row.slice(0, row.indexOf(DIM)).length, CURSOR_COL);
});

test("still anchors on the legacy reverse-video cursor block", () => {
  const lines = [`hello >>>${LEGACY_CURSOR_BLOCK_START} ${RESET}`];
  const rendered = renderGhostRows(lines, "Suggested continuation.", 120, ascii);

  assert.ok(rendered.length > lines.length, "legacy cursor block should anchor ghost rows");
  assert.equal(rendered[1].slice(0, rendered[1].indexOf(DIM)).length, CURSOR_COL);
});

test("caller-supplied anchors take precedence over the defaults", () => {
  const lines = ["hello >>>@@cursor@@ rest"];
  const rendered = renderGhostRows(lines, "Suggestion.", 120, ascii, ["@@cursor@@"]);

  assert.ok(rendered.length > 1);
  assert.equal(rendered[1].slice(0, rendered[1].indexOf(DIM)).length, CURSOR_COL);
});

test("returns base lines unchanged when there is no room for ghost text", () => {
  const lines = baseLines();
  // width equals the cursor column, leaving no room (available <= 1).
  assert.deepEqual(renderGhostRows(lines, "Suggestion.", CURSOR_COL, ascii), lines);
});

// ── wrapText ─────────────────────────────────────────────────────────────────

test("wrapText flows words within the width budget", () => {
  const wrapped = wrapText("alpha beta gamma delta", 11, ascii);
  assert.ok(wrapped.every((l) => l.length <= 11));
  assert.equal(wrapped.join(" "), "alpha beta gamma delta");
});

test("wrapText hard-clips words wider than the budget", () => {
  const wrapped = wrapText("supercalifragilistic", 8, ascii);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].length, 8);
});
