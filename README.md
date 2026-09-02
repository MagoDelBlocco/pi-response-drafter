# response-drafter

A transcript-grounded prompt elaboration loop for [Pi](https://github.com/earendil-works).

When control returns to you and you type something terse, a secondary "drafter"
model rewrites it into a well-formed prompt for the main agent — using only what's
in the transcript and your input — then shows it for **Accept / Edit / Reject /
Ask** before it's injected. Anything the drafter *inferred* is surfaced in a
flagged block at the top, and a non-empty flag block disables one-tap accept.

The job is **elaboration quality, not intent prediction.** You still supply intent
every cycle; the drafter articulates it more clearly without making things up.

## How it works

```
you type terse input ──/draft──▶ context assembler ──▶ drafter model
                                                            │
                              {mode, prompt, assumptions[], questions[]}
                                                            │
                  question? ──▶ ask you ──▶ re-draft        │
                                                            ▼
                                          review UI: Accept / Edit / Reject / Ask
                                                            │
                                       accept/edited ──▶ injected as the next prompt
                                       reject/failure ─▶ your raw input, unchanged
```

The safety model has two layers that work together:

1. **Generation time** — the drafter is contractually forbidden from introducing
   facts, diagnoses, file names, or requirements not present in the transcript or
   your input. Anything inferred must go into `assumptions`, never woven into the
   prompt. If intent is ambiguous and the transcript can't resolve it, it asks.
2. **Review time** — `assumptions` are rendered first, in warning color, and a
   non-empty `assumptions` block disables one-tap accept (a second confirm is
   required). The zero-assumption continuation case stays a true one-tap.

If the model call or its output ever fails, the loop degrades to your raw input —
it never blocks you.

## Usage

- `/draft fix the auth thing` — draft from your input.
- `/draft` (no args) — reconstruct the next step from the transcript.
- `/draft auto` — force **draft-every-round** for this session regardless of the `drafter-trigger` flag (also `/draft auto on` / `/draft auto off`). Note that drafting is already automatic by default (`drafter-trigger=always`), so every normal message you type is drafted before it reaches the main agent out of the box. `auto off` only reverts to the configured trigger — to actually stop auto-drafting, set `drafter-trigger=command` (or `drafter-enabled=false`). Reject in the review panel always sends your raw input, so it stays lossless.

In the review panel: `A`ccept · `E`dit · `R`eject · `?`Ask, or `↑↓` + `Enter`.

### Skipping the drafter

Not every prompt is worth drafting. Submit with **`alt+r`** instead of `Enter` and
your input goes to the agent verbatim — no drafter call, no review panel, no
latency. It's silent by design: nothing happening *is* the feedback.

`ctrl+enter` does the same thing, but only in terminals with enhanced/Kitty
keyboard mode — legacy terminals send a bare CR for it, indistinguishable from
`Enter`. `alt+r` works in both.

Mid-turn (agent still streaming) the drafter is bypassed anyway, and `alt+r`
simply steers, same as `Enter`.

> Why not `alt+enter`? Pi reserves it for `app.message.followUp`, and reserved
> bindings cause an extension's shortcut to be dropped entirely. The key is
> hardcoded rather than a flag because CLI flag values are applied *after*
> extensions load, so a flag couldn't be read at shortcut-registration time.

## Configuration (CLI flags)

| Flag | Default | Meaning |
|---|---|---|
| `drafter-enabled` | `true` | Master switch. |
| `drafter-model` | `""` | Drafter model as `provider/id` or bare `id`. Empty = main session model. |
| `drafter-context-turns` | `3` | Prior user-delimited turns of transcript to feed. |
| `drafter-trigger` | `always` | `command` (only `/draft`), `always`, or `threshold`. |
| `drafter-threshold-chars` | `120` | With `trigger=threshold`, auto-draft inputs longer than this. |
| `drafter-auto-accept` | `off` | `off` or `when_no_assumptions`. |
| `drafter-log-path` | `""` | Optional JSONL path for telemetry (see below). |

Drafter requests always send `chat_template_kwargs: {"enable_thinking": false}`
(the vLLM/SGLang convention, merged into the request body by pi-ai's
OpenAI-compatible adapters; non-OpenAI APIs ignore it) — drafting wants a direct
answer, not a chain-of-thought performance. No `temperature` is sent, so the
drafter runs at whatever temperature the model/server is configured with.

### Persistent config: `~/.pi/agent/drafter.json`

CLI flags are per-invocation. For permanent settings, put them in
`~/.pi/agent/drafter.json` — when the file is absent, everything behaves exactly
as before:

```json
{
  "model": "anthropic/claude-haiku-4-5",
  "trigger": "command",
  "contextTurns": 5
}
```

Precedence: **CLI flag > `drafter.json` > built-in default.** Keys are the
`DrafterConfig` fields in camelCase (`model`, `enabled`, `contextTurns`,
`trigger`, `thresholdChars`, `autoAccept`, `logPath`); `drafter-`-prefixed and
kebab/snake spellings are accepted. Invalid values are dropped per-key with a
warning at session start; unknown keys are reported and ignored. The file is
read once at extension load — edits need `/reload` or a restart.

## Telemetry (the self-check)

Each cycle logs `{terse_input, transcript_hash, mode, drafted_prompt, assumptions,
action, edited_to}` as a session entry (and to `drafter-log-path` if set). Review
accepted drafts whose `assumptions` were non-empty against what you actually knew:
a high rate of "invented but I accepted it anyway" means the review gate is failing
and `drafter-auto-accept` should stay `off`.

## Development

```
npm install
npm test        # unit tests for the pure modules (schema, context, config, telemetry)
npm run typecheck
```

The review UI reuses the ask-user extension's framed-box styling (titled borders,
spacer skeleton, select-list theme, dim/muted help hints). Edit live and `/reload`.

## Layout

- `index.ts` — wiring: flags, `/draft` command, raw-submit shortcuts, optional `input`-hook auto-trigger, the cycle orchestrator.
- `config.ts` — flag registration + resolution.
- `context.ts` — transcript slice assembler (recency-windowed by user turn).
- `prompt.ts` — the anti-fabrication system contract + prompt builder.
- `llm.ts` — model resolution + the one-shot drafter call.
- `schema.ts` — `DraftResult` type + tolerant JSON parsing.
- `review.ts` / `borders.ts` — the framed review overlay and its borders.
- `telemetry.ts` — the §13 self-check log.
