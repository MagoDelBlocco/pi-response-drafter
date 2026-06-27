# Spec: `prompt-drafter` — a transcript-grounded prompt elaboration loop for Pi

**Status:** Draft v0.1 · **Type:** Pi extension (TypeScript) · **Owner:** you

---

## 1. Purpose

After an agent round ends and control returns to the user, an auxiliary LLM ("the
drafter") reads the session and the user's terse input, produces a **well-formed
prompt** for the main agent, and presents it for **accept / edit / reject / ask**.
On accept, the prompt is injected back into the main agent loop and work continues.

The job of the drafter is **elaboration quality, not intent prediction.** It is not
guessing what you want — you still supply intent every cycle. It is articulating
what you already mean, in a form the main agent acts on more reliably than it would
on your lazy one-liner.

This framing is load-bearing for the whole design. If the drafter were predicting
intent, the approval gate would be redundant. Because it is *elaborating* stated
intent, the gate has a real job: "did it say what I meant, better — without making
things up?"

## 2. Goals / Non-goals

**Goals**
- Convert terse user input into a clearer, better-structured prompt for the main agent.
- Use the just-completed transcript as context so continuation prompts need minimal typing.
- Keep the user's actual epistemic state intact (don't upgrade "I don't know why
  it's broken" into a confident false diagnosis).
- Make the review step survivable under low effort — the motivating user trait is
  laziness at review, so the design must catch fabrication on a 3-second skim.

**Non-goals**
- Autonomous continuation (no human gate). Explicitly out of scope; see §12.
- Multi-step planning or task decomposition. The drafter writes *one* next prompt.
- Replacing the main agent's own reasoning. It only shapes the input to it.

## 3. The central risk this design exists to contain

**False specificity.** Asked to produce a *good* prompt from a vague one ("fix the
auth thing"), an unconstrained model will emit something confident and specific
("JWT validation fails on clock skew; add 30s tolerance"). That reads excellent and
may be invented. Your terse prompt honestly encoded "go look"; the elaboration
launders that uncertainty into a fabricated diagnosis, and the main agent now
chases a false lead — strictly worse than the one-liner.

The system's safety rests on catching these inventions at review. But review effort
is exactly what the user wants to minimize ("after a while I just accept it"). So
fabrication cannot be left for careful reading to catch; it must be **structurally
surfaced** and, where possible, **prevented at generation time.**

Two consequences drive the spec:
1. The drafter is contractually forbidden from introducing facts/diagnoses/requirements
   not present in the transcript or the user's input (§6).
2. Anything it *infers* is rendered in a flagged block that a skim catches, and a
   non-empty flag block blocks one-tap auto-accept (§7, §8).

## 4. Risk scales with grounding — hence two modes

- **Continuation / iteration prompts** are transcript-grounded. The agent just said
  what it did, skipped, and failed; "now handle the empty-input case" is reconstruction,
  not invention. **Low fabrication risk.**
- **New-direction prompts** ask the drafter to fill a void the transcript is silent on.
  **High fabrication risk** — this is where it confabulates.

The drafter must know which mode it's in and behave differently (§9). When grounding
is thin and intent is ambiguous, the correct move is not a confident guess but a
**question back to the user** — still less typing than writing the whole prompt yourself.

## 5. Flow

```
[main agent turn ends, control returns to user]
        │
        ▼
[user types terse input]  ──(or invokes /draft on empty input)
        │
        ▼
[context assembler]  → selects transcript slice + user input
        │
        ▼
[drafter LLM]  → emits {mode, prompt, assumptions[], questions[]}
        │
        ├── mode=question ──▶ [show questions to user] ──▶ user answers ──▶ re-draft
        │
        ▼
[review UI]  accept │ edit │ reject │ ask
        │
   accept/edited
        ▼
[injector]  → drafted prompt becomes the user message for the next main-agent turn
        │
        ▼
[main agent continues]
```

## 6. Component: the drafter

**Model.** A separate model/context from the main agent (cheaper/faster is fine;
this is a rewriting task, not the coding task). Configurable (§11). Precedent exists:
Pi-derived harnesses already run a second "advisor/reviewer" model on its own context
alongside the main agent, so a second model in the loop is an established pattern.

**System prompt contract (the anti-fabrication core).** Non-negotiable instructions:

> Rewrite the user's intent into a single, well-formed prompt for a coding agent.
> - Use ONLY information present in the transcript or the user's input.
> - Do NOT introduce facts, diagnoses, root causes, file names, or requirements not
>   present in those sources. If you are inferring something, do not state it as fact.
> - Anything you infer or assume goes in `assumptions`, not woven into `prompt`.
> - If the user's intent is ambiguous and the transcript does not resolve it, return
>   `mode: "question"` with specific questions instead of guessing.
> - Preserve the user's uncertainty. If they don't know the cause, the prompt should
>   ask the agent to investigate, not assert a cause.
> - Output strict JSON matching the schema. No prose outside it.

**Output schema:**
```json
{
  "mode": "continuation | new_direction | question",
  "prompt": "string (empty when mode=question)",
  "assumptions": ["each inferred/added element not stated by user or transcript"],
  "questions": ["populated only when mode=question"]
}
```

`assumptions` is the safety surface. An empty array is the drafter asserting "I added
nothing you didn't give me." A non-empty array is where lazy review must look — and
nowhere else.

## 7. Component: review UI

Rendered as a TUI overlay when control returns. Layout, top to bottom:

1. **Flagged assumptions block** (if non-empty) — visually distinct (e.g. warning
   color), at the **top**, so it's the first thing seen. This is the entire lazy-review
   mitigation: inventions are highlighted, not buried in fluent prose.
2. **The drafted prompt.**
3. **Actions:** `[A]ccept` · `[E]dit` · `[R]eject` · `[?]Ask`.

Rules:
- If `assumptions` is non-empty, **one-tap accept is disabled**; accept requires a
  second confirm (or the user must clear/acknowledge the flags). This deliberately
  taxes acceptance exactly when fabrication risk is present, and leaves the common
  zero-assumption continuation case as a true one-tap.
- `mode=question` replaces the prompt area with the questions; answering re-runs the
  drafter with the answers appended to context.
- `Edit` opens the prompt in the editor; the edited text is what gets injected (and
  logged as a correction — see §13).
- `Reject` falls back to sending the user's raw input unchanged to the main agent.
  Rejecting must never block you; the worst case degrades to "no extension."

## 8. Component: context assembler

Decides what the drafter sees. Keep it bounded and recency-weighted:
- Last *N* turns of transcript (default: the just-completed turn + prior 2–3),
  configurable.
- The user's current terse input.
- Optionally the active file set / last tool results if the harness exposes them
  cheaply.

Truncation strategy: prefer the *end* of the transcript (the most recent agent
output is the strongest grounding for a continuation). Do not feed the whole session
by default — more context here mostly adds cost and dilutes grounding, not accuracy.

## 9. Mode behavior

| Mode | Trigger | Drafter behavior | Review default |
|---|---|---|---|
| `continuation` | Transcript clearly constrains the next step | Reconstruct next instruction from what the agent just did/skipped/failed | One-tap accept if no assumptions |
| `new_direction` | User input introduces a step the transcript is silent on | Elaborate **only** the user's input; transcript used for style/context, not content. Heavier `assumptions` scrutiny | Accept gated behind assumption review |
| `question` | Intent ambiguous AND transcript doesn't resolve it | Emit specific questions, no prompt | N/A — answer to proceed |

## 10. Pi integration

Pi is a minimal, aggressively extensible terminal harness; extensions are TypeScript
modules with access to tools, slash commands, keyboard shortcuts, events, and the
full TUI, plus 25+ in-process hooks across session/input/tool/message/model-context/
system event categories. That is more than enough surface for this. Concretely:

- **Packaging:** a local extension (`.ts` in `~/.pi/agent/extensions/`) for personal
  use; later bundled as an npm/git Pi package if shared. Mid-session edits via `/reload`.
- **Trigger point:** hook the event category that fires when the agent loop completes
  and control returns to the user (the *input* / turn-boundary hooks). On that event,
  if the user submits non-empty input (or invokes a `/draft` command), run the loop.
- **Context access:** Pi extensions can read and filter the message history and inject
  messages before a turn — that is exactly the read-transcript / inject-prompt pair
  this needs.
- **Review UI:** Pi ships TUI primitives (Box, Text, Markdown, SelectList, overlays);
  the accept/edit/reject/ask panel is a SelectList inside an overlay.
- **Injection:** on accept, deliver the drafted text as the user message for the next
  turn (Pi's steering/inject-message path).

> **Confirm against Pi's TypeScript types before coding:** the exact hook names, the
> event-payload shape for "turn complete / control returned," and the precise API to
> inject a user message into the loop are not pinned in this spec. They exist (the
> capability categories are documented) but the signatures should be read off Pi's
> source/types rather than assumed. Flagging this rather than inventing a fake API is
> the same discipline the drafter itself is held to.

## 11. Configuration

```
drafter.model            # model id for the drafter (default: a fast/cheap model)
drafter.context_turns    # how many prior turns to feed (default: 3)
drafter.auto_accept      # off | when_no_assumptions (default: off initially)
drafter.enabled          # global toggle / per-project
ui.flag_color            # styling for the assumptions block
log.path                 # where draft/accept/edit telemetry goes (§13)
```

## 12. Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| Drafter invents a diagnosis/fact | Generation-time grounding contract (§6) + flagged assumptions block + accept gate on non-empty assumptions |
| Lazy review rubber-stamps a fabrication | Assumptions surfaced at top, color-flagged; one-tap accept disabled when assumptions present |
| Drafter guesses on ambiguous intent | `mode=question` short-circuits to asking instead of drafting |
| New-direction confabulation | Mode separation (§9); transcript used for style not content in new-direction mode |
| Extension adds latency/friction every turn | `/draft` opt-in, or auto-trigger only above an input-length threshold; reject path is instant and lossless |
| Scope creep toward autonomy | Explicit non-goal; the human gate is the product, not a temporary scaffold |

## 13. Telemetry — the self-check you currently can't run

Log each cycle: `{terse_input, transcript_hash, drafted_prompt, mode, assumptions,
action, edited_to}`.

This exists to answer the one question that determines whether the extension is
net-positive *for you*: when a drafted prompt "worked better," was the added content
**compression of knowledge you had but didn't type** (the win) or **invention that
happened to be right** (a coin flip you weren't tracking)? Periodically review accepted
drafts whose `assumptions` were non-empty and check them against what you actually
knew at the time. A high rate of "invented but I accepted it anyway" means the review
gate is failing and `auto_accept` should stay off.

## 14. Build phases

Staged so the cheapest version ships first and the fabrication surface is added only
once the UX is proven worthwhile.

- **Phase 0 — stateless polish (MVP).** No transcript. User types one sentence; drafter
  restructures/clarifies *only that*; show → accept/edit/reject. Near-zero fabrication
  surface because you supply intent every time. Validates whether elaboration even helps
  you, and proves the review UX, before any transcript machinery exists. *This is the
  Occam-minimal version of your idea — if it already gives you most of the value, you may
  not need the rest.*
- **Phase 1 — transcript-grounded continuation.** Add the context assembler and
  `continuation` mode with the assumptions schema and flagged-block UI.
- **Phase 2 — new-direction + question mode + telemetry.** Add `new_direction` handling,
  `question` short-circuit, and the §13 logging/self-check.

## 15. Open decisions

1. **Trigger:** always-on (every non-empty input goes through the drafter) vs explicit
   `/draft`? Always-on maximizes laziness benefit but multiplies latency and the chance
   of unwanted elaboration. Suggest starting explicit, then auto-enabling for inputs
   above a length/complexity threshold.
2. **Auto-accept policy:** is `when_no_assumptions` acceptable, or must every draft be
   seen? Depends on your Phase-0 fabrication-rate data (§13).
3. **Drafter model:** same family as the main agent (consistency) vs a cheaper one
   (cost)? Rewriting tolerates a smaller model; test for quality regressions.
4. **Failure of the drafter call** (timeout, bad JSON): silently fall back to raw user
   input, or surface the error? Suggest silent fallback — the extension must never be a
   gate that blocks you when it breaks.
