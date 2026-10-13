/**
 * Pure ghost-text layout helpers.
 *
 * Kept free of `pi-tui`/`pi-coding-agent` imports so they can be unit-tested in
 * isolation (those packages don't resolve under the bare test runner). Text
 * measurement is injected via {@link TextMetrics}: production wires in pi-tui's
 * ANSI/grapheme-aware `visibleWidth`/`truncateToWidth`; tests pass ASCII stubs.
 *
 * @module
 */

/**
 * Anchor for the cursor cell, i.e. the marker the base editor puts on the line
 * the cursor lives on. pi-tui (>= the 1.x split that moved reverse-video out of
 * the editor) renders the cursor as zero-width APC markers — `CURSOR_MARKER`
 * plus `FAKE_CURSOR_START … FAKE_CURSOR_END` — and only the TUI resolves those
 * to `ESC[7m` AFTER components have rendered. A render() override therefore
 * never sees literal reverse video; anchoring on `ESC[7m` silently finds nothing
 * and the preview disappears. See `deriveCursorAnchors()` in ghost-text.ts.
 */
export const FAKE_CURSOR_START = "\x1b_pi:fc\x07";

/** Pi <= the fake-cursor split drew the cursor block as literal reverse video. */
export const LEGACY_CURSOR_BLOCK_START = "\x1b[7m";

/** Anchors tried in order when the caller does not supply its own. */
export const DEFAULT_CURSOR_ANCHORS: readonly string[] = [FAKE_CURSOR_START, LEGACY_CURSOR_BLOCK_START];

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

/** Visible-width measurement, injected so the pure logic stays dependency-free. */
export interface TextMetrics {
  /** Visible column width of a (possibly styled) string. */
  width(text: string): number;
  /** Hard-clip `text` to at most `maxWidth` visible columns (no ellipsis). */
  clip(text: string, maxWidth: number): string;
}

/**
 * Trim leading and trailing blank lines from a suggestion. Returns null for a
 * null/empty/all-blank suggestion. Interior blank lines are preserved here (the
 * accept path inserts this text verbatim); {@link renderGhostRows} drops them
 * for display.
 */
export function normalizeSuggestion(suggestion: string | null): string | null {
  if (!suggestion) return null;
  const allLines = suggestion.split("\n");
  let start = 0;
  while (start < allLines.length && allLines[start].trim() === "") start++;
  let end = allLines.length - 1;
  while (end >= start && allLines[end].trim() === "") end--;
  return start <= end ? allLines.slice(start, end + 1).join("\n") : null;
}

/** Index of the first anchor present in `line`, or -1. */
function findAnchor(line: string, anchors: readonly string[]): number {
  let best = -1;
  for (const anchor of anchors) {
    const at = line.indexOf(anchor);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

/**
 * Splice dim ghost rows for `suggestion` into `baseLines`, just below the
 * cursor row.
 *
 * We anchor on the cursor marker the base editor always emits on the cursor row
 * (see {@link FAKE_CURSOR_START}), so this works whether or not the editor is
 * focused and never touches the border rows. Blank source lines (paragraph
 * breaks) are dropped so the preview stays compact. Returns `baseLines`
 * unchanged if no anchor is found or there is no room — the lossless default.
 */
export function renderGhostRows(
  baseLines: string[],
  suggestion: string,
  width: number,
  metrics: TextMetrics,
  anchors: readonly string[] = DEFAULT_CURSOR_ANCHORS,
): string[] {
  let anchorIndex = -1;
  let anchorColumn = -1;
  for (let i = 0; i < baseLines.length; i++) {
    const at = findAnchor(baseLines[i], anchors);
    if (at !== -1) {
      anchorIndex = i;
      anchorColumn = at;
      break;
    }
  }
  if (anchorIndex === -1) return baseLines;

  // Markers are zero-width escape sequences, so the width of the prefix is the
  // cursor column (pi-tui's visibleWidth strips APC/CSI codes).
  const cursorCol = metrics.width(baseLines[anchorIndex].slice(0, anchorColumn));
  const available = width - cursorCol;
  if (available <= 1) return baseLines;

  const rendered: string[] = [];
  for (const line of suggestion.split("\n")) {
    if (line.trim() === "") continue;
    for (const w of wrapText(line, available, metrics)) {
      if (!w) continue;
      rendered.push(`${" ".repeat(cursorCol)}${DIM}${w}${RESET}`);
    }
  }
  const result = baseLines.slice();
  result.splice(anchorIndex + 1, 0, ...rendered);
  return result;
}

/**
 * Word-wrap `text` to `maxWidth` visual columns.
 *
 * Splits on spaces and flows words onto subsequent lines. Words that are
 * individually wider than `maxWidth` are hard-clipped (no hyphenation).
 */
export function wrapText(text: string, maxWidth: number, metrics: TextMetrics): string[] {
  if (maxWidth <= 0) return [];
  const words = text.split(" ").filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const wordWidth = metrics.width(word);
    if (wordWidth > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(metrics.clip(word, maxWidth));
      continue;
    }
    const sepWidth = current ? 1 : 0;
    if (metrics.width(current) + sepWidth + wordWidth <= maxWidth) {
      current = current ? current + " " + word : word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
