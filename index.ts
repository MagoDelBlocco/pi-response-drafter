/**
 * Response Drafter Extension (spec: prompt-drafter).
 *
 * After an agent round ends and control returns to you, this turns terse input
 * into a well-formed prompt for the main agent, surfacing anything it INFERRED in
 * a flagged block before injection. The job is elaboration quality, not intent
 * prediction — you still supply intent every cycle; the drafter articulates it
 * more clearly without making things up.
 *
 * Trigger: enabled and automatic by default. Set `drafter-trigger=command`
 * to restrict to explicit `/draft` invocation only. Per-message, `alt+r` submits
 * the input raw and skips the drafter entirely.
 *
 * Safety rests on two things working together:
 *   - the anti-fabrication contract at generation time (prompt.ts §6), and
 *   - the flagged-assumptions block + accept gate at review time (review.ts §7).
 * If either the model call or parsing fails, the loop degrades to your raw input —
 * it must never block you (spec §15.4).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { getConfig, registerFlags, type DrafterConfig } from "./config";
import { loadFileConfig } from "./file-config";
import { parseAutoSubcommand } from "./commands";
import { assembleContext } from "./context";
import { buildDraftPrompt } from "./prompt";
import { resolveDrafterModel, runDrafter } from "./llm";
import { runReview, runQuestionReview } from "./review";
import { logCycle, type CycleAction } from "./telemetry";
import type { DraftResult } from "./schema";
import { createGhostTextEditor } from "./ghost-text";

const MAX_ROUNDS = 4;

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

/** What the cycle decided to do with the user's input. */
type CycleResult =
  | { kind: "text"; text: string } // a finalized drafted/edited prompt to inject
  | { kind: "raw" } // fall back to the user's raw input (reject / failure)
  | { kind: "none" }; // nothing to send (cancelled)

/**
 * Animate a "generating draft" status spinner. Returns a function that stops the
 * animation and clears the status (safe to call from a `finally`).
 */
function startSpinner(ctx: ExtensionContext): () => void {
  const label = ctx.ui.theme.fg("accent", "generating draft ");
  let frame = 0;
  let timer: NodeJS.Timeout;
  const tick = () => {
    ctx.ui.setStatus("drafter", ctx.ui.theme.bg("toolPendingBg", `${label}${ctx.ui.theme.fg("accent", SPINNER_FRAMES[frame])}`));
    frame = (frame + 1) % SPINNER_FRAMES.length;
    timer = setTimeout(tick, 90);
  };
  tick();
  return () => {
    clearTimeout(timer);
    ctx.ui.setStatus("drafter", undefined);
  };
}

export default function responseDrafter(pi: ExtensionAPI) {
  // ~/.pi/agent/drafter.json — the permanent home for settings that CLI flags
  // can't persist. Read once at load (same doctrine as prompt.md); values ride
  // in as registered flag defaults, so precedence is CLI > file > built-in.
  const fileConfig = loadFileConfig();

  // Surface a broken scroll without blocking anything (spec §15.4 applies to
  // config errors too): once per session start, only if the file exists and hurt.
  pi.on("session_start", async (_event, ctx) => {
    for (const err of fileConfig.errors) ctx.ui.notify(`Drafter config: ${err}`, "warning");
  });

  // The last drafter-failure reason we surfaced. We suppress repeats of the *same*
  // error to avoid spamming every turn, but a new/changed error or a recovery (a
  // later success clears this) re-arms notification — so a persistently broken
  // config can't go silent forever after the first failure.
  let lastFailureReason: string | null = null;

  // Session-level toggle for "draft every round". Defaults follow the config flag
  // (always by default). `/draft auto on|off` overrides the config for this session.
  let autoEnabled = false;

  /**
   * Run the full draft → (question/ask re-draft loop) → review cycle.
   * Pure of delivery: returns a decision the caller turns into either a
   * sendUserMessage (command path) or an InputEventResult (input-hook path).
   */
  async function runDraftCycle(rawText: string, ctx: ExtensionContext, config: DrafterConfig): Promise<CycleResult> {
    const model = resolveDrafterModel(ctx, config.model);
    if (!model) {
      ctx.ui.notify("Drafter: no model available — sending input unchanged", "warning");
      return { kind: "raw" };
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      ctx.ui.notify("Drafter: no API key — sending input unchanged", "warning");
      return { kind: "raw" };
    }

    const { transcriptText } = assembleContext(ctx.sessionManager.getBranch(), config.contextTurns);
    const clarifications: Array<{ question: string; answer: string }> = [];

    // Telemetry helper bound to this cycle's stable inputs.
    const log = (action: CycleAction, draft: DraftResult | null, editedTo: string | null) =>
      logCycle(pi, config.logPath, {
        terseInput: rawText,
        transcriptText,
        mode: draft ? draft.mode : "none",
        draftedPrompt: draft?.prompt ?? "",
        assumptions: draft?.assumptions ?? [],
        action,
        editedTo,
      });

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const userPrompt = buildDraftPrompt({ userInput: rawText, transcriptText, clarifications });

      let draft: DraftResult;
      const stopSpinner = startSpinner(ctx);
      try {
        draft = await runDrafter(model, { apiKey: auth.apiKey, headers: auth.headers }, userPrompt, ctx.signal);
        lastFailureReason = null; // a success re-arms failure notifications
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return { kind: "none" };
        const reason = err instanceof Error ? err.message : String(err);
        if (reason !== lastFailureReason) {
          lastFailureReason = reason;
          ctx.ui.notify(`Drafter failed (repeats of this error suppressed): ${reason}`, "error");
        }
        await log("fallback", null, null);
        return { kind: "raw" };
      } finally {
        stopSpinner();
      }

      // Parse failure / degenerate output: don't invent — fall back to raw input.
      if (draft.mode === "question" && draft.questions.length === 0) {
        await log("fallback", null, null);
        return { kind: "raw" };
      }

      // Question mode: show questions in a framed overlay, collect answers, re-draft (spec §9).
      if (draft.mode === "question") {
        let answered: Array<{ question: string; answer: string }>;
        try {
          answered = await runQuestionReview(ctx, draft.questions);
        } catch {
          await log("cancel", draft, null);
          return { kind: "raw" };
        }
        clarifications.push(...answered);
        continue;
      }

      // Auto-accept only the true zero-assumption case, and only if opted in.
      if (config.autoAccept === "when_no_assumptions" && draft.assumptions.length === 0) {
        await log("accept", draft, null);
        return { kind: "text", text: draft.prompt };
      }

      ctx.ui.setEditorComponent(createGhostTextEditor(draft.prompt));
      const outcome = await runReview(ctx, draft, rawText);
      ctx.ui.setEditorComponent(undefined);
      switch (outcome.kind) {
        case "accept":
          await log("accept", draft, null);
          return { kind: "text", text: outcome.text };
        case "edit":
          await log("edit", draft, outcome.text);
          return { kind: "text", text: outcome.text };
        case "reject":
          await log("reject", draft, null);
          return { kind: "raw" };
        case "ask":
          clarifications.push({ question: "(user guidance for revision)", answer: outcome.note });
          continue;
        case "cancel":
          await log("cancel", draft, null);
          return { kind: "none" };
      }
    }

    // Exhausted re-draft rounds without a decision: stay lossless.
    return { kind: "raw" };
  }

  // ── Explicit /draft command (default trigger) ──────────────────────────────
  pi.registerCommand("draft", {
    description: "Draft your input into a well-formed prompt for review. `/draft auto` toggles drafting every round",
    getArgumentCompletions: (prefix: string) => {
      if (!"auto".startsWith(prefix.trim().toLowerCase()) && !prefix.trim().toLowerCase().startsWith("auto")) {
        return null;
      }
      return [
        { value: "auto", label: "auto", description: `Toggle draft-every-round (currently ${autoEnabled ? "ON" : "OFF"})` },
        { value: "auto on", label: "auto on", description: "Draft every round from now on" },
        { value: "auto off", label: "auto off", description: "Stop drafting every round" },
      ];
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const config = getConfig(pi);

      // `/draft auto [on|off]` — toggle the session-level draft-every-round mode.
      const sub = parseAutoSubcommand(args);
      if (sub) {
        autoEnabled = sub === "toggle" ? !autoEnabled : sub === "on";
        ctx.ui.notify(
          autoEnabled
            ? "Drafter: auto-draft ON — every round now goes through the drafter"
            : "Drafter: auto-draft OFF — use /draft explicitly or change config",
          "info",
        );
        return;
      }

      if (!config.enabled) {
        if (args.trim()) pi.sendUserMessage(args);
        return;
      }
      const result = await runDraftCycle(args, ctx, config);
      if (result.kind === "text") {
        pi.sendUserMessage(result.text);
      } else if (result.kind === "raw") {
        if (args.trim()) pi.sendUserMessage(args);
        else ctx.ui.notify("Drafter: nothing to send", "info");
      } else {
        ctx.ui.notify("Drafter: cancelled", "info");
      }
    },
  });

  // ── Raw submit: send verbatim, bypassing the drafter ──────────────────────
  // Not every prompt is worth drafting. These keys submit exactly what's typed
  // as an extension message; the input hook below ignores non-interactive
  // sources, so it never gets drafted. Deliberately silent — the absence of the
  // review overlay is the only feedback needed.
  //
  // Two bindings because neither is universal:
  //   alt+r      — works in legacy terminals (ESC-prefixed) *and* under the
  //                Kitty protocol, and collides with no built-in binding.
  //   ctrl+enter — nicer muscle memory, but legacy terminals send a bare CR for
  //                it (indistinguishable from Enter), so it only fires under
  //                enhanced/Kitty keyboard mode.
  //
  // alt+enter would be the obvious choice and is NOT usable: Pi reserves it for
  // app.message.followUp, and reserved bindings drop an extension's shortcut
  // outright. The key is hardcoded rather than a flag because CLI flag values
  // are applied *after* extensions load, so getFlag() here would only ever see
  // its own default.
  const submitRaw = (ctx: ExtensionContext) => {
    const text = ctx.ui.getEditorText();
    if (!text.trim()) return;
    ctx.ui.setEditorText("");
    // Mirror what plain Enter does mid-turn (steer); idle is an ordinary send.
    pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "steer" });
  };

  pi.registerShortcut("alt+r", {
    description: "Send input to the agent raw, bypassing the drafter",
    handler: submitRaw,
  });
  pi.registerShortcut("ctrl+enter", {
    description: "Send input to the agent raw, bypassing the drafter (needs enhanced keyboard mode)",
    handler: submitRaw,
  });

  // ── Optional auto-trigger via the input hook (opt-in) ──────────────────────
  pi.on("input", async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
    const config = getConfig(pi);
    if (!config.enabled) return { action: "continue" };
    // Steering an already-working agent (not the user's idle turn): send exactly
    // what was typed. `streamingBehavior` is set while the agent is mid-turn and
    // undefined when idle — drafting only applies to fresh, idle-turn prompts.
    if (event.streamingBehavior !== undefined) return { action: "continue" };
    // `/draft auto` (runtime) forces always-mode; otherwise fall back to the flag.
    const trigger = autoEnabled ? "always" : config.trigger;
    if (trigger === "command") return { action: "continue" };
    // Only interactive, user-typed input; never recurse on extension-injected input.
    if (event.source !== "interactive") return { action: "continue" };
    const text = event.text.trim();
    if (!text) return { action: "continue" };
    if (trigger === "threshold" && text.length < config.thresholdChars) return { action: "continue" };

    const result = await runDraftCycle(event.text, ctx, config);
    if (result.kind === "text") return { action: "transform", text: result.text };
    // raw → let the original input through unchanged; none (cancel) → also lossless.
    return { action: "continue" };
  });

  registerFlags(pi, fileConfig.values);
}


