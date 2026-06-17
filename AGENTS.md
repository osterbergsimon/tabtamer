# AGENTS.md — TabTamer

## Project

Firefox extension (manifest v2) that auto-groups tabs via LLM. Source in `extension/`.

## Self-driving loop

`./loop.sh` controls everything: **build → archive → spec-write → review → repeat**.

- Do NOT skip the loop and run iteratr directly.
- Do NOT manually run the spec-writer — the loop does it.
- The loop stops when the spec-writer outputs the sentinel `# TabTamer — Complete`.
- To stop early: `touch .loop-quit` or Ctrl+C (clean trap).
- Max 20 phases; reviewer runs every 5 phases.
- Reviewer writes `specs/.review-summary` (printed to terminal by loop.sh)
  and `specs/.review-warning` (pauses loop) when needed.

**Stale state kills the loop**: always `rm -rf .iteratr` before starting, or the script's `--reset` handles it. If the loop dies mid-phase, nuke `.iteratr` and restart.

## Build output

iteratr output goes to `build.log` (raw) and `build.log.clean` (ANSI-stripped). Nothing on terminal — use `tail -f build.log.clean` in another shell to watch.

## Spec format

Every `specs/SPEC.md` must end with this exact meta-task (deliberate no-op):

```
- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. Do NOT run iteratr or the spec-writer from here.
  Simply mark this task as done without taking any action.
```

When modifying specs: keep tasks concrete with file names and what to change. Prioritize bugs → features → UX → docs.

## Spec-writer

`specs/SPEC-write-next.md` has 4 tasks (audit → UX → features → write). Runs with **pro model** (`opencode-go/deepseek-v4-pro`). Must NOT read `specs/archive/`. Must find genuinely new issues, not describe already-done work.

## Tests

```
npm test           # 16 unit tests via Node.js built-in runner
npm run lint       # web-ext extension lint
```

**Test environment quirk**: Node.js not installed globally. Use `nix-shell -p nodejs_22` then `npm test`.

**Mock quirk**: `tests/background.test.js` uses `eval(fs.readFileSync(...))` to load background.js into global scope — regular `require` would module-scope all functions and break the tests. The mock in `tests/setup.js` provides the full `browser.*` API surface (tabs, tabGroups, storage, alarms, notifications, runtime, browserAction, commands, contextMenus). Keep both in sync with the actual `browser.*` calls in background.js.

**Test names can break**: `assignToGroup` normalizes group names via `normalizeGroupName()` (title-case, lowercase rest). Tests passing `"GitHub"` will see `"Github"` in the mock. Use names that normalization doesn't change (e.g. `"Code"`).

## Architecture notes

- `extension/background.js` — all logic, event listeners, LLM calls, group management
- `extension/options.html` + `options.js` — settings page (API key, model, dark mode toggle, costs)
- `extension/manifest.json` — version gets bumped each phase. Permissions evolve.
- `extension/content.js` — content script for page interaction (SPA route detection)
- `extension/lib/rules-engine.js` — user-customizable domain→group rules

The `browser.*` API is **Firefox-only** — no Chrome compatibility. `manifest_version: 2`.

## Commands

```bash
nix-shell -p nodejs_22  # enter dev shell (Node.js + npm available)
npm test                 # run unit tests
npm run lint             # lint extension
./loop.sh               # start self-driving build loop
```

## Gotchas

- `local` is **bash function-only** — never use in `while`/`if` bodies at script level.
- `normalizeGroupName()` converts `"GitHub"` → `"Github"` — watch out in tests and mocks.
- `--auto-commit` in iteratr creates git commits. No-op detection checks `git diff` between before/after SHA.
- `specs/archive/` is gitignored — archived specs are for review/inspection only.
