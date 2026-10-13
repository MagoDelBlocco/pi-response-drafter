# AGENTS.md — response-drafter

## Orientation

A [Pi](https://github.com/earendil-works) coding-agent extension: a secondary
"drafter" LLM rewrites the user's terse input into a well-formed prompt, then
presents it in a review overlay (Accept / Edit / Reject / Ask) before injection
into the main agent loop. The consumer is a running Pi session — there is no
binary, no build output; Pi loads `./index.ts` directly (declared in
`package.json` → `pi.extensions`).

The load-bearing invariant is **losslessness**: every failure path (no model, no
API key, model error, unparseable output, exhausted re-draft rounds, user
cancel) must degrade to the user's raw input or a silent no-op — the drafter must
never block a prompt (spec §15.4). The second pillar is the **anti-fabrication
contract** (`prompt.md`, generation time) paired with the flagged-assumptions
gate (`review.ts`, review time). Weakening either is heresy against the design.

## Commands

```
npm install          # sets up deps; see Gotchas re: the file: dependency
npm test             # tsx --test tests/*.test.ts  (all tests)
npm run typecheck    # tsc --noEmit
npx tsx --test tests/schema.test.ts           # a single test file
npx tsx --test --test-name-pattern="coerces" tests/config.test.ts
```

No linter/formatter config exists. There is no build step — `tsc` is typecheck
only (`noEmit: true`); Pi transpiles the `.ts` sources itself.

Iteration loop: edit files, then run `/reload` inside a Pi session (README
"Development"). The runtime behavior of `index.ts`/`review.ts`/`ghost-text.ts`
can only be verified inside a live Pi session, not by the test suite.

## Architecture

Orchestrated by `runDraftCycle()` in `index.ts`. Two entry paths feed it and
differ only in delivery:

- `pi.on("input", …)` auto-trigger (default: `drafter-trigger=always`) → returns
  an `InputEventResult` (`transform` or `continue`).
- `/draft` command → `pi.sendUserMessage()`.

Cycle: `config.ts` (flag resolution) → `context.ts` (transcript slice, last N
user-delimited turns) → `prompt.ts` (system contract from `prompt.md` + user
prompt builder) → `llm.ts` (model resolution + one-shot `complete()` via
pi-ai compat; `runDrafter` hardcodes
`samplingParams.chat_template_kwargs.enable_thinking=false` for OpenAI-compatible
servers — ignored by other APIs — and deliberately sends **no `temperature`**,
letting the model run at its served default; do not re-hardcode one) →
`schema.ts` (tolerant JSON → `DraftResult`) → question-mode
re-draft loop (max 4 rounds, `MAX_ROUNDS`) → `review.ts` framed overlay (with
`borders.ts` styling; ghost-text preview via `ghost-text.ts` + `ghost-render.ts`)
→ `telemetry.ts` logs the cycle.

Raw-submit shortcuts (`alt+r`, `ctrl+enter` in `index.ts`) bypass everything and
send editor text verbatim.

Design spec: `extension_specs.md` — code comments cite it by section (§6 =
anti-fabrication contract, §7 = review gate, §11 = flags, §13 = telemetry, §15 =
trigger/degradation). Read it before changing safety-relevant behavior. User-facing
docs: `README.md`.

## Conventions

- ESM (`"type": "module"`); imports between modules use explicit `.ts`
  extensions (`allowImportingTsExtensions`). `strict: true`.
- Pure logic is deliberately separated from Pi-dependent UI so it is testable:
  `ghost-render.ts` (pure) vs `ghost-text.ts` (Pi-tui shell); `context.ts`,
  `schema.ts`, `config.ts`, `commands.ts`, `prompt.ts` are runtime-free or
  injectably-stubbed (`TextMetrics` injection in ghost-render; `piWith(flags)`
  stub in config tests). Follow this split when adding logic — the pi packages
  do **not** resolve under the bare test runner.
- Tests: `node:test` + `node:assert/strict` (no test framework), one
  `tests/<module>.test.ts` per pure module, flat `test()` calls with prose names.
- Config: precedence is **CLI flag > `~/.pi/agent/drafter.json` > `DEFAULTS`**
  (`config.ts`). The file (`file-config.ts`, pure-parsed) rides in as the
  *registered flag default* — Pi overwrites registered defaults with CLI values
  after load, so `getConfig` needs no knowledge of the file. `file-config.ts`
  accepts camelCase / kebab / `drafter-`-prefixed keys and drops invalid ones
  per-key with warnings. Flag table + file schema documented in README.
- `pi-ai` / `pi-tui` are consumed as transitive deps of `pi-coding-agent` via
  `tsconfig.json` `paths` mapping to nested `dist` — do not add them to
  `package.json` dependencies.

## Gotchas

- `package.json` depends on `@earendil-works/pi-coding-agent` via `file:` with a
  relative path to the **global npm install** (`../../../../.npm-global/...`);
  `node_modules/@earendil-works/pi-coding-agent` is a symlink. `npm install`
  fails wherever that path doesn't exist. `tsconfig.json` `paths` hardcode the
  same location.
- The ghost preview anchors on the **cursor marker** the base editor emits, which
  is *not* literal reverse video: pi-tui renders the cursor cell as zero-width APC
  markers (`CURSOR_MARKER` + `FAKE_CURSOR_START`) and the TUI resolves them to
  `ESC[7m` only *after* components render — so a `render()` override grepping for
  `ESC[7m` finds nothing and the preview vanishes silently (it did, on the upgrade
  to pi 1.2.0). `ghost-text.ts` re-derives the marker at load from the public
  `renderFakeCursor()` and injects it into the pure `renderGhostRows()`; pi-tui does
  not export the marker itself, so never hardcode it again.
- `prompt.md` (the anti-fabrication system contract) is read once at module load
  (`prompt.ts`); edits need `/reload` or a session restart, not just a file save.
  Same load-once doctrine applies to `~/.pi/agent/drafter.json`.
- Shortcut keys are **hardcoded on purpose**: CLI flag values are applied *after*
  extensions load, so `getFlag()` can't be read at shortcut-registration time.
  `alt+enter` is NOT usable — Pi reserves it for `app.message.followUp` and
  reserved bindings silently drop an extension's shortcut. `ctrl+enter` only
  fires under Kitty/enhanced keyboard mode (legacy terminals send a bare CR).
- The `input` hook's guards are load-bearing, not incidental: skip when
  `event.streamingBehavior !== undefined` (mid-turn steering must pass through)
  and when `event.source !== "interactive"` (otherwise the extension's own
  injected messages recurse forever).
- Drafting is automatic by default (`drafter-trigger=always`). `/draft auto off`
  only reverts to the configured trigger — actually stopping auto-drafting needs
  `drafter-trigger=command` or `drafter-enabled=false`.
- Non-empty `assumptions` intentionally disables one-tap Accept (second Accept
  confirms). Do not "fix" this friction; it is the entire lazy-review mitigation.
- Failure notifications suppress repeats of the *same* error message; a success
  re-arms them. Changing this risks a broken config going silent.
- `.claude/`, `.pi/`, and `__pycache__/` are gitignored local noise; the stale
  `__pycache__/email_filter.cpython-313.pyc` is a leftover, not project source.
