# TabTamer — Phase 7

## Overview

Phase 7 is a stability + UX polish release with one marquee feature: **Group Splitting**. Three real bugs are fixed (stale group IDs, batch fallback re-classification, badge debounce flicker), a major code-deduplication is done on the repeated "group list + tab count" pattern, performance is improved via query memoization and state caching, and the spec ships Group Splitting — when a group grows beyond 15 tabs, the LLM analyzes tab content and suggests 2–5 thematic sub-groups.

Also lands several UX improvements: the popup stays open after classify (for power users batch-classifying tabs), a "Classify All Ungrouped" button is added, rules gain drag-to-reorder, the options page gets an unsaved-changes indicator, and first-time users get an onboarding overlay.

## Files to modify

```
extension/
├── manifest.json              — bump to 1.12.0
├── background.js              — bug fixes, dedup, group splitting, memoization
├── popup.html                 — new buttons, layout tweaks
├── popup.js                   — keep-open behavior, classify-all, onboarding
├── options.html               — unsaved indicator, drag-to-reorder
├── options.js                 — drag-to-reorder logic, unsaved-changes UI
├── popup.css                  — new button styles, onboarding overlay
└── lib/
    └── utils.js               — pull shared group-list helper here
tests/
└── background.test.js         — tests for new GroupSplitting logic
```

## Tasks

- [ ] **T7.0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions, gotchas, and architecture
  notes. Also read `DESIGN.md` for component architecture and open questions.
  Pay attention to: `normalizeGroupName()` title-case behavior, the
  `_managedGroupIds` tracking mechanism, and the mock setup in
  `tests/setup.js` that must stay in sync with any new `browser.*` calls.

### Bugs

- [ ] **T7.1: Fix stale `_managedGroupIds` accumulation**
  In `extension/background.js`, `_managedGroupIds` (a `Set`) only grows via
  `markGroupManaged()` — it never prunes group IDs that no longer exist. If a
  user manually deletes a group, stale IDs cause wasted `browser.tabGroups.get()`
  queries and potentially incorrect "already in group" checks.
  
  Fix: add a `_pruneManagedGroupIds()` function that queries all current
  groups via `browser.tabGroups.query({})`, collects their IDs, and removes
  any `_managedGroupIds` entry not in that set. Call it once on startup and
  periodically (e.g., every 30 minutes via alarm, or lazily before any
  classification pass).

- [ ] **T7.2: Fix `batchClassifyTabs` fallback re-classifying already-assigned tabs**
  In `extension/background.js`, when the batch LLM call doesn't assign a
  group to a tab (~lines 596–601), it falls back to `classifyWithContent()`.
  But `classifyWithContent` doesn't re-check the classification cache for
  the domain — it may issue a redundant LLM call for a domain that was just
  cached by another tab in the same batch.
  
  Fix: before falling back to `classifyWithContent()`, check the cache for
  the tab's domain. If a cached group exists, use it directly. Only call
  the LLM if the cache is cold.

- [ ] **T7.3: Fix `updateBadge` debounce flicker on hibernation state change**
  In `extension/background.js`, `_hibernationBadgeActive` can toggle between
  true/false, but `updateBadge()` uses a 500ms debounce. If the state flips
  and `updateBadge()` fires mid-debounce, the badge may briefly show a stale
  state.
  
  Fix: store the *target* badge state separately from the debounce timer.
  When the debounced function fires, it reads the latest target state rather
  than a snapshot captured at call time. Also, if a new call arrives while
  a debounced call is pending, cancel the old debounce and schedule a new one
  with the updated state (ensure the timer is keyed by state or a counter).

### Code Quality

- [ ] **T7.4: Deduplicate "group list + tab count" pattern into a shared helper**
  In `extension/background.js`, the logic to query all groups, count tabs
  per group, sort by tab count, and build `promptGroupList` capped at
  `MAX_GROUP_NAMES_IN_PROMPT` exists identically in four places:
  - `classifyAndAssign` (~lines 1374–1397)
  - `classifyWithContent` (~lines 1540–1558)
  - `batchClassifyTabs` (~lines 471–491)
  - `_buildMergePrompt` (~lines 2244–2262)

  Extract a single function: `async getGroupListForPrompt(maxGroups)` that
  returns `{ groupNames, promptGroupList, totalGroups, groupsWithCounts }`.
  Move it to `extension/lib/utils.js` and replace all four inline copies.

### Performance

- [ ] **T7.5: Memoize `browser.tabs.query({})` per event-loop tick**
  In `extension/background.js`, `classifyWithContent` queries all tabs,
  then `batchClassifyTabs` also queries all tabs, then `handleTab` →
  `_classifyTabPreLLM` may query tabs again within the same classification
  pass — wasting API calls. In `extension/options.js`, tab queries are
  made separately for different sections (cache dashboard, rules table) when
  they could share results.

  Fix: add a short-lived memo (e.g., a module-level variable invalidated
  after 500ms or by a `setTimeout(0)` on the next tick) so that repeated
  `browser.tabs.query({})` calls within the same synchronous flow return the
  cached result.

- [ ] **T7.6: Cache `isEnabled()` result, invalidate via `storage.onChanged`**
  In `extension/background.js`, `isEnabled()` reads from `browser.storage`
  on every `handleTab` call — a simple boolean that rarely changes. Cache the
  enabled state in a module variable. Listen to `browser.storage.onChanged`
  and update the cache only when the `enabled` key changes. This eliminates
  an async storage read from the hot path.

### Features

- [ ] **T7.7: Group Splitting — LLM-powered sub-group creation**
  **The marquee Phase 7 feature.** When a managed group exceeds a configurable
  threshold (default: 15 tabs, stored in `extension/options.html` as "Group
  Split Threshold"), trigger a Group Split analysis:
  
  1. **Detection**: In `extension/background.js`, add a check after each
     classification pass: if any managed group now has > threshold tabs,
     call the new `splitGroup(groupId)` function.
  2. **Content collection**: For each tab in the oversized group, extract
     page title, URL, and (if content-based classification is enabled) page
     content via the existing content-script pipeline. Batch all tabs into
     a single prompt.
  3. **LLM prompt**: Send all tab info to the LLM with a prompt like:
     *"This group '{groupName}' has {count} tabs. Suggest 2–5 sub-groups by
     theme. For each tab, assign exactly one sub-group. Use hierarchical
     names like 'Code / AG Grid', 'Code / Rust'. Respond as JSON: {sub_groups:
     [{name, tab_indices: [...]}]}"*
  4. **User approval**: Show a notification with the suggested sub-groups.
     Clicking opens a small popup/page listing the proposed splits with
     checkboxes to accept/reject individual sub-groups. Users can also
     rename sub-groups inline before confirming.
  5. **Execution**: On confirm, create new tab groups with the approved
     names, assign distinct colors (cycling through existing `TAB_GROUP_COLORS`
     from constants), and move tabs into them. Mark all new groups as managed.
  6. **Settings**: Add a "Group Split Threshold" input in
     `extension/options.html` (default: 15, range: 10–50). Add an on/off
     toggle "Auto-suggest group splits" (default: on). Add a "Split Group"
     button in `extension/popup.html` next to each oversized group.
  7. **Tests**: Add tests in `tests/background.test.js` for: split suggestion
     generation (mock LLM response), threshold detection, sub-group naming,
     and edge cases (empty group, group at exactly threshold, all tabs in
     one sub-group).

  Also add manual split trigger: in `extension/popup.html`, next to each
  managed group with > threshold tabs, show a "Split" action button.

- [ ] **T7.8: Proactive "Save as Rule" on single-tab classification**
  DESIGN.md §3 mentions prompting "Save domain → Group as a rule?" after
  each classification. Currently only `suggestRulesFromCache()` exists for
  batch rule creation. Add a flow in `extension/background.js`: after
  `classifyAndAssign` successfully classifies a single tab (non-batch, non-rule
  match), show a small animated notification: *"Save example.com → '{Group}'
  as a rule?"* with [Save] [Dismiss] buttons. Saved rules go into the rules
  engine. Add a "Prompt for rule after classification" toggle in
  `extension/options.html` (default: off to avoid notification fatigue).

### UX

- [ ] **T7.9: Keep popup open after classify, add close-on-click-outside**
  In `extension/popup.js` (~line 287), the popup auto-closes 1.5s after a
  successful classify. Change behavior: keep the popup open after classify
  so power users can classify multiple tabs in sequence. The result toast
  still shows. Add a "Close" button or rely on click-outside-to-close
  (Firefox popups auto-close on blur by default — verify this works).
  Add a subtle animation/refresh on the group list after classify so users
  see the result without re-opening.

- [ ] **T7.10: Add "Classify All Ungrouped" button to popup**
  In `extension/popup.html` and `extension/popup.js`, add a button between
  "Classify Tab" and "Scan Now": "Classify All Ungrouped". This triggers
  `batchClassifyTabs` for all tabs not currently in a group (i.e., tabs
  with `groupId === browser.tabGroups.TAB_GROUP_ID_NONE`). Show a
  progress/spinner while classifying, then display a summary toast
  (e.g., "Classified 12 tabs into 4 groups").

- [ ] **T7.11: Drag-to-reorder rules in options page**
  In `extension/options.html` and `extension/options.js`, implement
  drag-and-drop reordering for the rules table. Use the HTML5 Drag and Drop
  API (no library needed). On drop, update the rule order in the rules
  engine's storage array and re-render the table. Save automatically
  (rules already auto-save on change). Add visual feedback: drag handle
  (⋮⋮ icon) on the left of each row, drop indicator line between rows,
  and a subtle scale/opacity animation on the dragged row.

- [ ] **T7.12: Unsaved changes indicator on options page**
  In `extension/options.html` and `extension/options.js`, the `_isDirty`
  flag only triggers `beforeunload`. Add a visible indicator:
  - A "● Unsaved changes" badge in the page header (next to the title or
    as a fixed top bar) that appears when `_isDirty` is true.
  - Change the "Save" button color to a warning/orange when dirty.
  - Fade/animate the indicator when changes are saved successfully.

- [ ] **T7.13: First-time user onboarding**
  In `extension/popup.html` + `extension/popup.css`, detect first-run (no
  API key configured + no groups exist). Show a 3-step onboarding overlay:
  1. "Welcome to TabTamer! 🎉 I auto-group your tabs using AI."
  2. "Step 1: Set your API key in Settings →" [Open Settings button]
  3. "Step 2: Open some tabs and I'll organize them automatically."
  Dismiss with a "Got it" button or by opening settings. Store a
  `onboardingComplete` flag in storage to never show again. Also show
  a small hint in the empty state: "No groups yet — open a few tabs and
  browse, or click 'Classify Tab' to get started."

- [ ] **T7.14: Make group tags clickable in popup**
  In `extension/popup.js`, the group name tags in the group list are static
  `<span>` elements. Make them clickable links that focus the first tab in
  that group via `browser.tabs.update(firstTabId, { active: true })`. Add
  a subtle hover style (underline, color change) and a `title` attribute:
  "Click to switch to this group's first tab".

- [ ] **T7.15: Complete popup shortcut hints**
  In `extension/popup.html` footer, currently only `Ctrl+Shift+E` (popup)
  is shown. Add `Ctrl+Shift+K` (search) and `Ctrl+Shift+G` (toggle) to the
  footer hint row so all three shortcuts are discoverable.

### Meta

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.

## Design notes

- **Group Splitting prompt**: The LLM prompt should include the group's
  current name as hierarchical prefix (e.g., "Code" → "Code / AG Grid").
  Tab content enrichment (title, h1, visible text) from the existing
  content-script pipeline produces better sub-group suggestions than
  URL-only classification.
- **Sub-group colors**: When creating sub-groups, assign distinct colors
  from `TAB_GROUP_COLORS` cycling — avoid reusing the parent group's color
  to make the split visually obvious.
- **Split threshold**: 15 tabs is the default. Power users with 200+ tabs
  may want 20–30. Single-tab groups should never trigger splitting.
- **Popup keep-open**: Firefox popups auto-close on blur (clicking outside).
  Test that this works naturally without custom event listeners.
- **Rules drag-to-reorder**: The rules array in storage is ordered.
  Drag-to-reorder just changes array indices. No migration needed.
- **Onboarding**: Must be unobtrusive — no auto-advancing slides, no
  mandatory tour. Three static steps with a single dismiss.
- Bump `extension/manifest.json` version to `1.12.0`.
