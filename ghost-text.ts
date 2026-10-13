/**
 * Ghost-text editor component.
 *
 * Extends PI's CustomEditor and renders prompt suggestions as dim ghost text
 * after the cursor in the existing input area. No new editor is introduced.
 * The pure layout logic lives in {@link module:ghost-render}.
 *
 * @module
 */

import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  type EditorOptions,
  type EditorTheme,
  matchesKey,
  renderFakeCursor,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_CURSOR_ANCHORS,
  normalizeSuggestion,
  renderGhostRows,
  type TextMetrics,
} from "./ghost-render";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GhostTextCallbacks {
  onAccept: (suggestion: string) => void;
  onDismiss: () => void;
  onInput?: () => void;
}

export interface GhostTextEditorOptions extends EditorOptions {
  callbacks: GhostTextCallbacks;
}

// pi-tui's ANSI/grapheme-aware measurement, injected into the pure layout code.
const METRICS: TextMetrics = {
  width: visibleWidth,
  clip: (text, maxWidth) => truncateToWidth(text, maxWidth, ""),
};

/**
 * Cursor anchors for the layout code, derived from the live pi-tui build.
 *
 * The editor marks the cursor row with `FAKE_CURSOR_START`, which pi-tui does
 * NOT export; `renderFakeCursor()` is the public way to obtain the pair, so we
 * probe it with a sentinel instead of duplicating a private constant and being
 * silently broken by the next upgrade (which is exactly how the preview died
 * once). The built-in defaults stay in the list as a fallback.
 */
function deriveCursorAnchors(): string[] {
  const sentinel = "\u0000pi-fake-cursor\u0000";
  // Guarded because the probe reaches into a third-party render helper whose
  // contract we infer rather than read: a future pi-tui that changes
  // renderFakeCursor() (or throws on a sentinel it doesn't expect) must degrade to
  // the built-in anchors, never crash extension load. Losslessness (spec §15.4)
  // outranks a precise anchor.
  try {
    const probe = renderFakeCursor(sentinel);
    const at = probe.indexOf(sentinel);
    const start = at > 0 ? probe.slice(0, at) : "";
    // A degenerate probe (marker absent, or the whole string echoed) is no anchor.
    if (start && start !== probe && !probe.includes(start + sentinel + start)) {
      return [start, ...DEFAULT_CURSOR_ANCHORS];
    }
  } catch (err) {
    // Deliberately swallowed: the anchor probe is best-effort. Falling back to the
    // built-in defaults keeps the preview working as well as it can, and a broken
    // preview must never break the prompt (spec §15.4).
    void err;
  }
  return [...DEFAULT_CURSOR_ANCHORS];
}

const CURSOR_ANCHORS = deriveCursorAnchors();

// ── Component ──────────────────────────────────────────────────────────────

export class GhostTextEditor extends CustomEditor {
  private suggestion: string | null = null;
  private callbacks: GhostTextCallbacks;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    options: GhostTextEditorOptions,
  ) {
    const { callbacks, ...editorOptions } = options;
    super(tui, theme, keybindings, editorOptions);
    this.callbacks = callbacks;
  }

  // ── Ghost text API ──────────────────────────────────────────

  setSuggestion(suggestion: string | null): void {
    this.suggestion = normalizeSuggestion(suggestion);
    this.tui.requestRender();
  }

  clearGhost(): void {
    this.suggestion = null;
    this.tui.requestRender();
  }

  // ── Input handling ──────────────────────────────────────────

  override handleInput(data: string): void {
    if (this.suggestion) {
      if (matchesKey(data, "right")) {
        this.insertTextAtCursor(this.suggestion);
        this.callbacks.onAccept(this.suggestion);
        this.clearGhost();
        return;
      }
      if (matchesKey(data, "escape")) {
        this.clearGhost();
        this.callbacks.onDismiss();
        return;
      }
    } else {
      this.callbacks.onInput?.();
    }
    super.handleInput(data);
  }

  // ── Rendering ───────────────────────────────────────────────

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!this.suggestion) return lines;
    return renderGhostRows(lines, this.suggestion, width, METRICS, CURSOR_ANCHORS);
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createGhostTextEditor(prompt: string) {
  return (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
    const editor = new GhostTextEditor(tui, theme, keybindings, {
      callbacks: {
        onAccept: () => {},
        onDismiss: () => {},
      },
    });
    editor.setSuggestion(prompt);
    return editor;
  };
}
