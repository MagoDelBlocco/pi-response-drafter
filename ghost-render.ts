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

const CURSOR_BLOCK_START = "\x1b[7m";
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

/**
 * Splice dim ghost rows for `suggestion` into `baseLines`, just below the
 * cursor row.
 *
 * We anchor on the inverse-video cursor block the base editor always renders
 * (`ESC[7m … ESC[0m`), so this works whether or not the editor is focused and
 * never touches the border rows. Blank source lines (paragraph breaks) are
 * dropped so the preview stays compact. Returns `baseLines` unchanged if the
 * cursor block is absent or there is no room.
 */
export function renderGhostRows(
  baseLines: string[],
  suggestion: string,
  width: number,
  metrics: TextMetrics,
): string[] {
  const anchorIndex = baseLines.findIndex((l) => l.includes(CURSOR_BLOCK_START));
  if (anchorIndex === -1) return baseLines;
  const anchorLine = baseLines[anchorIndex];

  const cursorCol = metrics.width(anchorLine.slice(0, anchorLine.indexOf(CURSOR_BLOCK_START)));
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
