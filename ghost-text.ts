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
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { normalizeSuggestion, renderGhostRows, type TextMetrics } from "./ghost-render";

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
    return renderGhostRows(lines, this.suggestion, width, METRICS);
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
