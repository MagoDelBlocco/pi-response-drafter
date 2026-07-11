/**
 * Review UI (spec §7), styled to match the ask-user extension.
 *
 * Layout, top to bottom, inside a framed box (same look as ask_user):
 *   1. Title.
 *   2. Flagged assumptions block (warning color), FIRST after the title so it is
 *      the first thing seen. This is the entire lazy-review mitigation — inventions
 *      are highlighted, not buried in fluent prose.
 *   3. The drafted prompt.
 *   4. Actions list: Accept / Edit / Reject / Ask.
 *   5. Help hints.
 *
 * Accept gate: when assumptions is non-empty, one-tap accept is disabled — the
 * first Accept arms a confirm, the second confirms. This taxes acceptance exactly
 * when fabrication risk is present and leaves the zero-assumption continuation
 * case as a true one-tap.
 *
 * Two paths: the framed custom TUI overlay (interactive mode) and a
 * select()/editor() dialog fallback (RPC/headless), mirroring how ask-user
 * degrades.
 */

import { createRequire } from "node:module";
import {
  Container,
  Text,
  Spacer,
  SelectList,
  type SelectItem,
  type SelectListTheme,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { DraftResult } from "./schema";
import { BoxBorderTop, BoxBorderBottom } from "./borders";
import { notifyDesktop } from "./notify";

const _require = createRequire(import.meta.url);
const VERSION: string = (_require("./package.json") as { version: string }).version;

const BOX_BORDER_LEFT = "│ ";
const BOX_BORDER_RIGHT = " │";
const BOX_BORDER_OVERHEAD = BOX_BORDER_LEFT.length + BOX_BORDER_RIGHT.length;

export type ReviewOutcome =
  | { kind: "accept"; text: string }
  | { kind: "edit"; text: string }
  | { kind: "reject" }
  | { kind: "ask"; note: string }
  | { kind: "cancel" };

type Action = "accept" | "edit" | "reject" | "ask" | "cancel";

const ACTION_ITEMS: SelectItem[] = [
  { value: "accept", label: "Accept", description: "Inject this prompt into the main agent" },
  { value: "edit", label: "Edit", description: "Edit before injecting" },
  { value: "reject", label: "Reject", description: "Send your raw input unchanged" },
  { value: "ask", label: "Ask", description: "Tell the drafter what to revise, then re-draft" },
];

// ── Style helpers (mirrors ask-user/src/utils.ts) ────────────────────────────

function createSelectListTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (t: string) => theme.fg("accent", t),
    selectedText: (t: string) => theme.fg("accent", t),
    description: (t: string) => theme.fg("muted", t),
    scrollInfo: (t: string) => theme.fg("dim", t),
    noMatch: (t: string) => theme.fg("warning", t),
  };
}

function literalHint(theme: Theme, key: string, description: string): string {
  return `${theme.fg("dim", key)}${theme.fg("muted", ` ${description}`)}`;
}

class ReviewComponent extends Container {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly draft: DraftResult;
  private readonly hasAssumptions: boolean;
  private readonly done: (outcome: Action) => void;

  private titleText = new Text("", 1, 0);
  private assumptionsText?: Text;
  private list: SelectList;
  private helpText = new Text("", 1, 0);
  private confirmArmed = false;

  constructor(tui: TUI, theme: Theme, draft: DraftResult, done: (outcome: Action) => void) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.draft = draft;
    this.hasAssumptions = draft.assumptions.length > 0;
    this.done = done;

    this.list = new SelectList(ACTION_ITEMS, ACTION_ITEMS.length, createSelectListTheme(theme));
    this.list.onSelect = (item) => this.choose(item.value as Action);
    this.list.onCancel = () => this.done("cancel");

    // Layout skeleton (same shape as AskComponent: spacer-separated sections).
    this.addChild(new Spacer(1));
    this.addChild(this.titleText);
    this.addChild(new Spacer(1));

    if (this.hasAssumptions) {
      this.assumptionsText = new Text("", 1, 0);
      this.addChild(this.assumptionsText);
      this.addChild(new Spacer(1));
    }

    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.helpText);
    this.addChild(new Spacer(1));

    this.updateText();
  }

  private updateText(): void {
    const t = this.theme;
    this.titleText.setText(
      t.fg("accent", t.bold("Review draft")) + t.fg("dim", `  (mode: ${this.draft.mode})`),
    );

    if (this.assumptionsText) {
      const lines = [t.fg("warning", t.bold("⚠ Assumptions — verify these were not invented:"))];
      for (const a of this.draft.assumptions) {
        lines.push(t.fg("warning", `  • ${a}`));
      }
      this.assumptionsText.setText(lines.join("\n"));
    }

    this.helpText.setText(this.buildHints());
  }

  private buildHints(): string {
    const t = this.theme;
    const hints: string[] = [
      literalHint(t, "↑↓", "navigate"),
      literalHint(t, "a/e/r/?", "actions"),
      literalHint(t, "↵", this.confirmArmed ? "confirm accept" : "select"),
      literalHint(t, "esc", "cancel"),
    ];
    if (this.hasAssumptions && !this.confirmArmed) {
      hints.unshift(t.fg("warning", "assumptions present — accept needs a second confirm"));
    }
    return hints.join(t.fg("dim", " • "));
  }

  private choose(action: Action): void {
    if (action === "accept" && this.hasAssumptions && !this.confirmArmed) {
      this.confirmArmed = true;
      this.updateText();
      this.tui.requestRender();
      return;
    }
    this.done(action);
  }

  override invalidate(): void {
    super.invalidate();
    this.updateText();
  }

  handleInput(data: string): void {
    const key = data.toLowerCase();
    if (key === "a") return this.choose("accept");
    if (key === "e") return this.done("edit");
    if (key === "r") return this.done("reject");
    if (key === "?") return this.done("ask");
    this.list.handleInput(data);
    this.tui.requestRender();
  }

  override render(width: number): string[] {
    const innerWidth = Math.max(1, width - BOX_BORDER_OVERHEAD);
    const innerLines = super.render(innerWidth);

    const borderColor = (s: string) => this.theme.fg("accent", s);
    const titleColor = (s: string) => this.theme.fg("dim", this.theme.bold(s));
    const labelColor = (s: string) => this.theme.fg("dim", s);
    const bgFn = (s: string) => this.theme.bg("selectedBg", s);

    const top = bgFn(new BoxBorderTop(borderColor, "response-drafter", titleColor).render(width)[0]);
    const bottom = bgFn(new BoxBorderBottom(borderColor, `v${VERSION}`, labelColor).render(width)[0]);
    const body = innerLines.map((line) => {
      const padded = truncateToWidth(line, innerWidth, "", true);
      return bgFn(`${borderColor(BOX_BORDER_LEFT)}${padded}${borderColor(BOX_BORDER_RIGHT)}`);
    });

    return [top, ...body, bottom];
  }
}

/**
 * Run the review interaction and resolve the user's decision.
 *
 * Resolves the follow-up dialogs (edit editor, ask note) before returning, so the
 * caller receives a fully-formed outcome.
 */
export async function runReview(ctx: ExtensionContext, draft: DraftResult, _rawInput: string): Promise<ReviewOutcome> {
  let action: Action | undefined;

  if (ctx.mode === "tui") {
    notifyDesktop("Drafter: review draft", `mode: ${draft.mode}, assumptions: ${draft.assumptions.length}`);
    action = await ctx.ui.custom<Action>(
      (tui, theme, _keybindings, done) => new ReviewComponent(tui, theme, draft, done),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center" as const,
          width: "92%",
          minWidth: 40,
          maxHeight: "60%",
          margin: 1,
        },
      },
    );
  }

  // Fallback for RPC/headless (custom returns undefined) or non-tui modes.
  if (action === undefined) {
    action = await runReviewDialogs(ctx, draft);
  }

  const editorText = ctx.ui.getEditorText();
  switch (action) {
    case "accept":
      return { kind: "accept", text: editorText || draft.prompt };
    case "edit": {
      notifyDesktop("Drafter: edit draft", `mode: ${draft.mode}`);
      const edited = await ctx.ui.editor("Edit the drafted prompt", editorText || draft.prompt);
      if (edited === undefined || edited.trim().length === 0) return { kind: "cancel" };
      return { kind: "edit", text: edited.trim() };
    }
    case "reject":
      return { kind: "reject" };
    case "ask": {
      notifyDesktop("Drafter: enter guidance", `mode: ${draft.mode}`);
      const note = await ctx.ui.input("What should the drafter revise or add?", "Your guidance...");
      if (note === undefined || note.trim().length === 0) return { kind: "cancel" };
      return { kind: "ask", note: note.trim() };
    }
    default:
      return { kind: "cancel" };
  }
}

/** Dialog-based fallback that still surfaces the assumptions before the choice. */
async function runReviewDialogs(ctx: ExtensionContext, draft: DraftResult): Promise<Action> {
  notifyDesktop("Drafter: review draft", `mode: ${draft.mode}, assumptions: ${draft.assumptions.length}`);
  const assumptionBlock = draft.assumptions.length
    ? `\n\n⚠ Assumptions (verify):\n${draft.assumptions.map((a) => `  • ${a}`).join("\n")}`
    : "";
  const title = `Review draft (mode: ${draft.mode})${assumptionBlock}`;

  const labels = ACTION_ITEMS.map((i) => i.label);
  const choice = await ctx.ui.select(title, labels);
  if (choice === undefined) return "cancel";
  const picked = ACTION_ITEMS.find((i) => i.label === choice)?.value as Action | undefined;
  if (picked === undefined) return "cancel";

  // Honor the accept gate in the dialog path too.
  if (picked === "accept" && draft.assumptions.length > 0) {
    notifyDesktop("Drafter: confirm accept", `assumptions: ${draft.assumptions.length}`);
    const confirmed = await ctx.ui.confirm("Confirm accept", "This draft contains assumptions. Inject it anyway?");
    return confirmed ? "accept" : "cancel";
  }
  return picked;
}

// ── Question-mode review UI ────────────────────────────────────────────────

type QuestionAction = `answer-${number}` | "submit" | "cancel";

class QuestionComponent extends Container {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly questions: string[];
  private readonly answers: (string | undefined)[];
  private readonly done: (action: QuestionAction) => void;

  private titleText = new Text("", 1, 0);
  private questionsText = new Text("", 1, 0);
  private list: SelectList;
  private helpText = new Text("", 1, 0);

  constructor(
    tui: TUI,
    theme: Theme,
    questions: string[],
    answers: (string | undefined)[],
    done: (action: QuestionAction) => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.questions = questions;
    this.answers = answers;
    this.done = done;

    this.titleText = new Text("", 1, 0);
    this.questionsText = new Text("", 1, 0);
    this.helpText = new Text("", 1, 0);

    const allAnswered = answers.every((a) => a !== undefined && a.length > 0);
    const items: SelectItem[] = [];
    questions.forEach((q, i) => {
      if (answers[i] === undefined || answers[i].length === 0) {
        items.push({
          value: `answer-${i}`,
          label: "Answer",
          description: q.length > 60 ? q.slice(0, 60) + "…" : q,
        });
      }
    });
    if (allAnswered) {
      items.push({ value: "submit", label: "Submit", description: "Send answers to drafter" });
    }
    items.push({ value: "cancel", label: "Cancel", description: "Send raw input unchanged" });

    this.list = new SelectList(items, Math.min(items.length, 5), createSelectListTheme(theme));
    this.list.onSelect = (item) => this.choose(item.value as QuestionAction);
    this.list.onCancel = () => this.done("cancel");

    this.addChild(new Spacer(1));
    this.addChild(this.titleText);
    this.addChild(new Spacer(1));
    this.addChild(this.questionsText);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.helpText);
    this.addChild(new Spacer(1));

    this.updateText();
  }

  private updateText(): void {
    const t = this.theme;
    this.titleText.setText(t.fg("accent", t.bold("Drafter needs clarification")));

    const lines: string[] = [];
    this.questions.forEach((q, i) => {
      const answered = this.answers[i] !== undefined && this.answers[i].length > 0;
      const prefix = answered ? t.fg("success", "✓") : t.fg("warning", "○");
      const answerText = answered ? ` ${t.fg("dim", `→ \"${this.answers[i]}\"`)}` : "";
      lines.push(`${prefix} ${t.fg("text", `Q${i + 1}: ${q}`)}${answerText}`);
    });
    this.questionsText.setText(lines.join("\n"));

    const answered = this.answers.filter((a) => a !== undefined && a.length > 0).length;
    this.helpText.setText(
      [
        literalHint(t, "↑↓", "navigate"),
        literalHint(t, "↵", "select"),
        literalHint(t, "esc", "cancel"),
        t.fg("dim", `${answered}/${this.questions.length} answered`),
      ].join(t.fg("dim", " • ")),
    );
  }

  private choose(action: QuestionAction): void {
    this.done(action);
  }

  override invalidate(): void {
    super.invalidate();
    this.updateText();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
    this.tui.requestRender();
  }

  override render(width: number): string[] {
    const innerWidth = Math.max(1, width - BOX_BORDER_OVERHEAD);
    const innerLines = super.render(innerWidth);
    const borderColor = (s: string) => this.theme.fg("accent", s);
    const titleColor = (s: string) => this.theme.fg("dim", this.theme.bold(s));
    const labelColor = (s: string) => this.theme.fg("dim", s);
    const bgFn = (s: string) => this.theme.bg("selectedBg", s);

    const top = bgFn(new BoxBorderTop(borderColor, "response-drafter", titleColor).render(width)[0]);
    const bottom = bgFn(new BoxBorderBottom(borderColor, `v${VERSION}`, labelColor).render(width)[0]);
    const body = innerLines.map((line) => {
      const padded = truncateToWidth(line, innerWidth, "", true);
      return bgFn(`${borderColor(BOX_BORDER_LEFT)}${padded}${borderColor(BOX_BORDER_RIGHT)}`);
    });

    return [top, ...body, bottom];
  }
}

/**
 * Run the question-mode review interaction and resolve the user's answers.
 *
 * Presents questions in a framed overlay (same style as the draft review),
 * collects answers via standard input dialogs, and returns the Q&A pairs.
 */
export async function runQuestionReview(
  ctx: ExtensionContext,
  questions: string[],
): Promise<Array<{ question: string; answer: string }>> {
  const answers: (string | undefined)[] = new Array(questions.length).fill(undefined);

  while (true) {
    notifyDesktop("Drafter: needs clarification", `${questions.length} question(s) to answer`);
    const action = await ctx.ui.custom<QuestionAction>(
      (tui, theme, _keybindings, done) => new QuestionComponent(tui, theme, questions, answers, done),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center" as const,
          width: "92%",
          minWidth: 40,
          maxHeight: "60%",
          margin: 1,
        },
      },
    );

    if (action === undefined || action === "cancel") {
      throw new Error("cancelled");
    }

    if (action.startsWith("answer-")) {
      const index = Number(action.split("-")[1]);
      notifyDesktop("Drafter: answer question", `Q${index + 1}: ${questions[index]}`);
      const answer = await ctx.ui.input(questions[index], "Your answer (Esc to cancel)…");
      if (answer === undefined) throw new Error("cancelled");
      answers[index] = answer.trim();
      continue;
    }

    if (action === "submit") {
      return questions
        .map((question, i) => ({ question, answer: answers[i] ?? "" }))
        .filter((item) => item.answer.length > 0);
    }
  }
}
