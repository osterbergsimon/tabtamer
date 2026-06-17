# Spec Writer — Generate next SPEC.md

## Overview

Inspect the current TabTamer codebase and produce a fresh `specs/SPEC.md`
with genuinely NEW tasks, OR declare the project complete.

## CRITICAL: This is NOT a verification pass

You are NOT checking whether the current spec's tasks are done. The current
spec is already fully implemented — ignore it entirely. The old spec has been
moved to `specs/archive/` — do NOT read archived specs. Read ONLY the source
code and decide what's next.

Think ambitiously. You are not just a bug-finder — you are a product designer.
Ask: what would make this extension 10× better? What would a daily user love?

## Tasks

- [ ] **Task 0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions, constraints, gotchas, and
  architecture notes that apply to this spec-writing session. Pay particular
  attention to: the spec-writer constraints (must NOT read `specs/archive/`,
  must find genuinely new issues), the meta-task format requirement, and
  test/naming quirks that generated specs must account for.

- [ ] **Task 1: Source code audit — bugs, quality, security**
  Read every source file with a critical eye: `extension/manifest.json`,
  `extension/background.js`, `extension/options.html`, `extension/options.js`.
  Also read `DESIGN.md` and `TESTING.md`. Do NOT read `specs/archive/`.

  Find problems:
  - **Bugs**: real logic errors, edge cases, race conditions, silent failures
  - **Code quality**: dead code, magic numbers, functions too large, duplicate logic
  - **Security**: exposed keys in logs/code, missing CSP, overly broad permissions
  - **Performance**: wasted API calls, missing debounce, startup flood

  Write findings in the iteration summary. Be specific: file, line pattern,
  what's wrong. Do NOT write the spec yet.

- [ ] **Task 2: UX & feature gap analysis**
  Re-read the same files, now from a user's perspective:
  - **UX gaps**: confusing flows, missing feedback, accessibility issues,
    no progress indication, poor error messages
  - **Missing features**: things DESIGN.md mentions but aren't built,
    open questions from docs that are still unresolved
  - **Polish**: rough edges, inconsistent styling, missing dark mode toggle,
    no keyboard shortcuts, no loading states

  Write findings in the iteration summary. Do NOT write the spec yet.

- [ ] **Task 3: Feature ideation — think big**
  You are not just a bug-finder. You are a product designer. Read the code
  one more time, then brainstorm real feature ideas.
  **Remember the core intent**: a cheap LLM automatically categorizes tabs —
  that's the differentiator. Rules and caching are optimizations on top of the
  LLM, not replacements for it. Features should amplify the LLM's intelligence,
  not bypass it.
  - What would make a power user's daily life better?
  - What would make someone recommend this extension?
  - What's the ONE feature that could make this feel like v2.0?

  Concrete examples of the ambition level:
  - **Content-based classification**: extract page headlines and visible text
    so the LLM classifies by *topic/theme* instead of just domain. Cross-domain
    grouping — docs site + GitHub repo + StackOverflow thread all in one group
    because they're about the same library. Currently only URL + title are sent;
    reading <title>, <h1>, and first ~500 chars of visible text would let the
    LLM see what the page is actually about. Opt-in; skipped for rule matches.
  - **Group splitting**: when a group grows beyond a threshold (e.g. 15 tabs),
    ask the LLM to suggest 2–5 sub-groups by theme. "Code" with 40 tabs becomes
    "Code / AG Grid", "Code / Rust", "Code / Dotfiles". Hierarchical naming
    keeps parent context visible. User approves the split via notification.
  - **LLM-assisted rule creation**: the LLM classifies a tab → prompt the user
    "Save `github.com → Code` as a rule?" → user approves → rule locks in, LLM
    never called for that domain again. The LLM could also batch-scan the cache
    and proactively suggest rules with confidence scores. This closes the loop:
    LLM intelligence builds the rule set, rules eliminate future API costs.
    User must always be able to override rules (force LLM or handle manually),
    including a global toggle to turn rules off entirely and use LLM-only mode.
  - Adaptive group renaming: rename groups when their content drifts (e.g. a
    "GitHub" group filling with docs pages becomes "Dev Resources").
  - Firefox Container integration: auto-assign tabs to containers based on
    group (e.g. "Work" tabs in a work container, personal in another).
  - Multi-provider support: since the API is OpenAI-compatible, let users
    plug in any endpoint — OpenRouter, Ollama, llama.cpp, Together AI.
    Just configurable base URL + model + key. Ship with presets.
  - Tab hibernation for non-managed groups: detect and hibernate idle tabs
    even outside TabTamer groups.
  - Multi-window support: sync group visibility across windows, move tabs
    between windows by group.
  - Drag-and-drop group reorder in the toolbar popup.
  - Smart tab search with fuzzy group filtering and keyboard-driven actions.

  Pick the best 1-3 feature ideas. Write them in the iteration summary.
  Do NOT write the spec yet.

- [ ] **Task 4: Write the next SPEC.md from all findings**
  Combine all findings from Tasks 1-3. The iteration summaries contain
  everything you need.

  **If you found real improvements (≥3):**
  Write a fresh `specs/SPEC.md`:
  - `# TabTamer — Phase N` (if no previous phase, start at Phase 1;
    otherwise increment from the last phase in specs/archive/ or git log)
  - `## Overview` — what this phase achieves, why it matters
  - `## Files to modify` tree
  - `## Tasks` — one checkbox per finding, prioritised:
  0. Read AGENTS.md (always first — see the template below)
     ```
     - [ ] **T{phase}.0: Read AGENTS.md**
       Read `AGENTS.md` for project conventions, gotchas, and architecture
       notes. Also read `DESIGN.md` for component architecture.
     ```
  1. Bugs (blockers first)
  2. Missing features / gaps
  3. Big new features (at least 1-2 per spec!)
  4. UX polish
  5. Documentation
  - `## Design notes`
  - Bump manifest version
  - Last task MUST be:
    ```
    - [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
      This is a deliberate no-op. The outer shell loop (./loop.sh) handles
      the build → spec-write → build cycle. Do NOT run iteratr or the
      spec-writer from here. Simply mark this task as done without taking
      any action.
    ```

  **If all tasks found nothing worth doing:**
  Write ONLY:
  ```
  # TabTamer — Complete
  - [x] Project complete — no further improvements found
  ```

  Do NOT touch source files — only write `specs/SPEC.md`.
  After writing: mark complete, write iteration-summary, call session-complete.
