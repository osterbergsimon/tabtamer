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

- [ ] **Task 1: Deep inspection — read everything, list ALL findings**
  Read every source file: `extension/manifest.json`, `extension/background.js`,
  `extension/options.html`, `extension/options.js`. Also read `DESIGN.md` and
  `TESTING.md`. Do NOT read anything in `specs/archive/`.

  Document every finding, grouped by category. Be exhaustive:

  - **Bugs**: real bugs, edge cases, race conditions, silent failures
  - **Missing features**: things DESIGN.md mentions but aren't built, open questions
  - **UX issues**: confusing flows, missing feedback, accessibility
  - **Code quality**: dead code, magic numbers, too-large functions, duplicate logic
  - **Security**: exposed keys, missing CSP, over-broad permissions
  - **Performance**: wasted API calls, missing debounce, startup flood
  - **Documentation**: stale docs, incorrect test expectations

  Also — and this is equally important — think about FEATURES:
  - What would make a power user's life better after daily use?
  - What would make someone recommend this extension to a colleague?
  - Examples of the kind of ambition we want: group color/label customization,
    smart tab search within groups, import/export of domain→group mappings,
    user-customizable group rules ("always put `github.com/*` in 'Code'"),
    a toolbar button showing group stats, drag-and-drop group reordering,
    adaptive group naming (LLM re-classifies group name if content drifts),
    multi-window support, tab hibernation for idle groups, integration
    with Firefox containers, a popup showing recent classifications with
    confidence scores.
  - Think: what's the NEXT big feature that would make this feel like a
    v2.0 product, not just incremental polish?

  Mark this task complete in iteration #1. Write an iteration summary listing
  your concrete findings. Do NOT write the spec yet — that's Task 2.

- [ ] **Task 2: Write the next SPEC.md from your findings**
  This runs in iteration #2. Your Task 1 summary contains the findings.

  **If you found real improvements (≥3):**
  Write a fresh `specs/SPEC.md`:
  - `# TabTamer — Phase N` (increment from current)
  - `## Overview` — what this phase achieves, why it matters
  - `## Files to modify` tree
  - `## Tasks` — one checkbox per finding, prioritised:
    1. Bugs (blockers first)
    2. Missing features / feature gaps
    3. Big new features (the ambitious ones — at least 1-2 per spec!)
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

  **If Task 1 found nothing worth doing:**
  Write ONLY:
  ```
  # TabTamer — Complete
  - [x] Project complete — no further improvements found
  ```

  Do NOT touch source files — only write `specs/SPEC.md`.
  Mark this task complete, write iteration-summary, call session-complete.
