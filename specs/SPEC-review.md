# Progress Reviewer — check that the loop is making real progress

## Overview

Every few outer loop turns, inspect the project to verify that meaningful
progress has been made. If the loop is spinning on trivial changes or no-op
builds, flag it so the user can intervene.

## CRITICAL

You are evaluating the LOOP, not the code. Your job is to check:
1. Has real progress been made across recent phases?
2. Is the spec-writer finding worthwhile tasks?
3. Is the build agent completing them successfully?

## Tasks

- [ ] **Task 0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions and loop rules. Pay attention to:
  the reviewer cadence (every 5 phases), the `.loop-quit` mechanism, the
  `.review-warning` file behavior, and the stale-state rule.

- [ ] **Review progress across recent phases**
  Check `specs/archive/` to see how many phases have been run. Read the last
  3-5 archived spec files to see what tasks were identified and (presumably)
  completed.

  Check `git log --oneline` to see recent commits. Are they meaningful?
  Or are they trivial formatting/whitespace changes?

  Check the current codebase state:
  - Read `extension/manifest.json` — what version?
  - Read `extension/background.js` — skim for feature completeness
  - Read `extension/options.html` — skim for UI quality

  Answer these questions in your iteration summary:
  1. How many phases have run?
  2. What's the current version number?
  3. Are recent commits meaningful (real features added, bugs fixed)?
  4. Is the extension noticeably better than v1.0.0?
  5. Is the loop still productive, or is it spinning on trivia?

  After analysis, write a concise summary to `specs/.review-summary`.
  This is the user-visible report. Use this format:

  ```
  # TabTamer Loop Review — Phase N (vX.Y.Z)
  ## Since last review
  - Bullet list of new features, fixes, and notable changes
  ## Loop health
  - One sentence: productive / spinning / needs attention
  ## Recommendation
  - Continue / pause / adjust focus
  ```

  Keep it under 15 lines. The shell loop prints this file to the terminal
  so the user sees it immediately.

  If the loop is clearly making good progress — write the summary
  and call session-complete.

  If the loop is spinning (trivial commits, no-op builds, same tasks
  repeating) — also write a file called `specs/.review-warning` with a brief
  explanation of what's wrong. Then call session-complete. `loop.sh` will
  detect both files: the summary is printed, the warning pauses the loop.
