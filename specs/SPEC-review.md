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

  If the loop is clearly making good progress — note that in the summary
  and call session-complete. This is an FYI for the user.

  If the loop is spinning (trivial commits, no-op builds, same tasks
  repeating) — write a file called `specs/.review-warning` with a brief
  explanation of what's wrong. Then call session-complete. `loop.sh` will
  detect this file and pause for user intervention.

  Do NOT modify any source files. Read-only analysis.
