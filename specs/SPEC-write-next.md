# Spec Writer — Generate next SPEC.md

## Overview

Inspect the current TabTamer codebase and produce a fresh `specs/SPEC.md`
with genuinely NEW tasks, OR declare the project complete.

## CRITICAL: This is NOT a verification pass

You are NOT checking whether the current spec's tasks are done. You are
finding NEW problems that the current spec does NOT cover. The current
spec is already fully implemented — ignore it. Treat the codebase as-is
and ask: "what else could be improved?"

## Tasks

- [ ] **Review codebase AND write next SPEC.md — single pass, no stopping**
  Read every source file in `extension/` with a critical eye:
  `manifest.json`, `background.js`, `options.html`, `options.js`.
  Also read `DESIGN.md` and `TESTING.md`.

  Look for NEW issues (the current spec is already implemented — ignore it):
  - Bugs, edge cases, missing error handling, race conditions
  - Missing features from DESIGN.md open questions
  - UX gaps, accessibility, missing feedback
  - Code quality: dead code, magic numbers, duplicated logic
  - Security: CSP, exposed keys, broad permissions
  - Performance: wasted calls, missing debounce, startup flood
  - Documentation: stale content, incorrect test procedures
  - **Features**: ideas that would make the extension genuinely better —
    tab search/filter within groups, group color coding, export/import
    cache, keyboard shortcuts for group management, pin groups, group
    statistics dashboard, manual re-classification per tab, confidence
    scores in options, smarter prompt engineering, SPA route handling.
    Think about what a power user would want after using this daily.

  You MUST do BOTH review AND writing in this single task — do not stop
  between them. The output is `specs/SPEC.md`.

  **If you found real improvements (≥3):**
  Write a fresh `specs/SPEC.md`:
  - `# TabTamer — Phase N` (increment phase number from current)
  - `## Overview`
  - `## Files to modify` tree
  - `## Tasks` — one checkbox per issue found, concrete and actionable
  - `## Design notes`
  - Bump manifest version
  - Last task MUST be this exact meta-task:
    ```
    - [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
      This is a deliberate no-op. The outer shell loop (./loop.sh) handles
      the build → spec-write → build cycle. Do NOT run iteratr or the
      spec-writer from here. Simply mark this task as done without taking
      any action.
    ```

  **If you genuinely found nothing:**
  Write ONLY these two lines (no meta-task, nothing else):
  ```
  # TabTamer — Complete
  - [x] Project complete — no further improvements found
  ```

  Do NOT touch source files — only write `specs/SPEC.md`.

  **After writing SPEC.md:** mark this task complete, write iteration-summary,
  and call session-complete immediately. There is only ONE task — do not
  leave it pending for another iteration. Complete in a single pass.
