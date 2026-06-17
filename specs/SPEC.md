# TabTamer — Phase 11

## Overview

Phase 11 is a **stability & intelligence** release. We fix 8 bugs (including a
hibernation badge race, duplicate code, and provider preset cost overwrite),
close 6 UX gaps (keyboard shortcuts, error feedback, source indicators), and
deliver the foundation for **LLM-powered batch tab clustering** — sending all
ungrouped tabs in a single LLM call for coherent, cost-efficient grouping.

The theme: **make the LLM see the whole picture, and make the extension feel
polished for daily use.**

## Files to modify

```
extension/
├── manifest.json          (bump 1.10.0 → 1.11.0, add _execute_browser_action command)
├── background.js          (fix badge race, consolidate helpers → lib/utils.js,
│                            fix markGroupManaged redundancy, fix _managedGroupIds init,
│                            fix _showRuleSuggestion timeout persistence,
│                            add batch clustering mode, add source to recent classifications)
├── lib/utils.js           (import _getCacheGroupName, _getCacheTimestamp from bg.js;
│                            add _getCacheGroupName, _getCacheTimestamp exports)
├── lib/constants.js       (add SEARCH_DEBOUNCE_MS import path for options.js)
├── popup.html             (keyboard shortcut hint, interactive group tags)
├── popup.js               (refactor showLoading/hideLoading, error feedback on classify,
│                            source indicators in recent list, interactive group tags,
│                            empty-state guidance)
├── options.html           (reset-to-defaults button, spinner for suggest-rules modal,
│                            rules-table hit counts column)
├── options.js             (fix onProviderPresetChange cost overwrite, use SEARCH_DEBOUNCE_MS,
│                            reset-to-defaults logic, hit count display, refactor _debounceTimer)
├── search.html            (tab action buttons: close, ungroup)
├── search.js              (close tab action, ungroup action, batch-select handling)
└── tests/
    └── background.test.js (tests for batch clustering, badge fix, helper consolidation)
```

## Tasks

### Read conventions

- [ ] **T11.0: Read AGENTS.md and DESIGN.md**
  Read `AGENTS.md` for project conventions, gotchas (normalizeGroupName, local
  keyword, test environment quirk with Node.js/nix-shell), and architecture notes.
  Read `DESIGN.md` for remaining open questions and component design.

### Bugs

- [ ] **T11.1: Fix hibernation badge race condition**
  In `extension/background.js`, `hibernateIdleTabs()` directly calls
  `browser.browserAction.setBadgeText({ text: '💤' + count })`, but
  `updateBadge()` is debounced at 500ms and will overwrite the hibernation
  indicator within half a second. Fix: have `hibernateIdleTabs()` call
  `updateBadge()` (which respects the group count + managed state) instead of
  directly setting the badge, OR set a flag that `updateBadge()` checks to
  prepend the 💤 prefix. Ensure the badge shows group count normally after the
  hibernation sweep completes.

- [ ] **T11.2: Consolidate duplicate helper functions into lib/utils.js**
  `_getCacheGroupName` and `_getCacheTimestamp` exist in both
  `extension/background.js` (~line 828) and `extension/options.js` (~line 403).
  Move both functions to `extension/lib/utils.js`, export them, and update both
  callers to import from the shared module. This eliminates ~14 lines of
  duplicate code and ensures cache structure changes only need one update.
  Verify existing tests still pass after the refactor.

- [ ] **T11.3: Fix hardcoded debounce in cache search**
  In `extension/options.js`, the cache search input handler uses a literal
  `200` millisecond delay instead of `SEARCH_DEBOUNCE_MS` from
  `extension/lib/constants.js`. Replace the magic number with the constant.
  Also refactor `_debounceTimer` from an ad-hoc DOM element property to a
  module-scoped variable.

- [ ] **T11.4: Fix provider preset cost overwrite bug**
  In `extension/options.js`, `onProviderPresetChange()` compares
  `currentCost === 1.0` to decide whether to overwrite the user's cost-per-M
  setting. A user who deliberately sets $1.00/M-token gets it overwritten when
  switching presets. Fix: track whether the user has manually edited the cost
  field (via a `data-user-edited` attribute or a module-scoped flag), and only
  auto-fill the cost on preset change if the user hasn't customized it.

- [ ] **T11.5: Remove redundant storage writes in markGroupManaged**
  In `extension/background.js`, `markGroupManaged()` writes to
  `browser.storage.local` every time it's called, even when the group ID is
  already tracked in `_managedGroupIds`. Add an early-return check: if the
  group is already in the set, skip the storage write. This eliminates wasteful
  I/O during bulk classification (e.g., startup scan assigning 20 tabs to the
  same group).

- [ ] **T11.6: Persist _showRuleSuggestion timeout across extension reload**
  In `extension/background.js`, `_showRuleSuggestion()` uses `setTimeout` to
  auto-dismiss suggestion notifications after 30 seconds. If the background
  page is suspended (event page), the timeout is lost and
  `_pendingSuggestionNotificationIds` accumulates orphaned entries. Fix: store
  pending suggestion metadata (notification ID + expiry timestamp) in
  `browser.storage.local`, and on startup, re-check expired suggestions and
  clean up.

- [ ] **T11.7: Fix _managedGroupIds initialization inconsistency**
  In `extension/background.js`, `_managedGroupIds` is initialized to `null` on
  storage load failure (line ~295) and later "healed" to `new Set()` by
  `markGroupManaged`. Other functions check `!managedGroupIds` and skip
  operations — but a healed empty Set passes `!` check (empty Set is truthy)
  vs. `null` (falsy), creating inconsistent behavior. Fix: always initialize to
  `new Set()` regardless of load outcome, and use `_managedGroupIds.size === 0`
  for "not yet loaded" checks instead of falsiness.

- [ ] **T11.8: Refactor popup showLoading/hideLoading to use CSS classes**
  In `extension/popup.js`, `showLoading()` and `hideLoading()` directly
  manipulate `element.style.display` on 8 hardcoded elements. This is fragile
  and races with `renderState()`. Replace with CSS class toggling: add a
  `.loading` class on the popup container, and use CSS rules
  (`.loading .recent-list { display: none }`, etc.) to handle visibility.
  This is a single class toggle instead of 8 inline style mutations.

### Feature: Batch Tab Clustering

- [ ] **T11.9: Implement LLM-powered batch tab clustering for startup scan**
  Add a new function `batchClassifyTabs(tabs)` in `extension/background.js`.
  During `startupScan()`, collect all ungrouped tabs (those with no group and
  no cache/rule match) and send them in a single LLM call. The prompt format:
  ```
  You are a tab grouping assistant. Given a list of tabs with URLs and titles,
  group them into 3-7 coherent groups. Return JSON only:
  {"groups": [{"name": "Group Name", "tabIndices": [0, 3, 7]}, ...]}
  ```
  Parse the response, create groups, and assign tabs in batch. Individual
  classification (`classifyAndAssign()`) remains for new tabs opened during
  browsing. Add a preference `batchClusteringEnabled` (default: true) in
  options. This reduces API costs (1 call instead of N) and produces more
  coherent groups since the LLM sees all tabs together.

### UX Improvements

- [ ] **T11.10: Add keyboard shortcut to open popup**
  In `extension/manifest.json`, add a `commands` entry for
  `_execute_browser_action` with a suggested shortcut (e.g., Ctrl+Shift+E on
  Linux/Windows, Cmd+Shift+E on Mac). Show the shortcut hint in the popup
  footer: "Press Ctrl+Shift+E to open". Update `extension/popup.html`
  accordingly.

- [ ] **T11.11: Show error feedback when "Classify Tab" fails**
  In `extension/popup.js`, the "Classify Tab" button handler closes the popup
  after 500ms regardless of outcome (line ~285). If the LLM call fails, the
  user sees "Classifying…" and the window closes with no indication of failure.
  Fix: wait for the classification result before closing, show a brief
  success/error state (green checkmark or red X) for 1.5 seconds, then close.
  If the call fails, keep the popup open and show the error message.

- [ ] **T11.12: Add source indicators to recent classifications**
  In `extension/popup.js`, the recent classifications list shows
  `domain → group` but doesn't indicate whether it was a rule match (free),
  cache hit (free), or LLM call (costs money). Add a small colored dot or icon
  next to each entry: 🟢 for rule, 🟡 for cache, 🔵 for LLM. In
  `extension/background.js`, store the source (`'rule'`, `'cache'`, `'llm'`)
  alongside each recent classification entry. Show a legend at the bottom of
  the recent list.

- [ ] **T11.13: Add empty-state guidance to popup**
  In `extension/popup.js`, when no managed groups exist, show actionable text
  instead of the bare "No TabTamer-managed groups yet" message. New text:
  "Open a few tabs and browse — they'll auto-group as you go. Or click
  'Classify Tab' to group the current tab now." Update
  `extension/popup.html` with the new copy.

- [ ] **T11.14: Add "Reset to defaults" button in options**
  In `extension/options.html`, add a "Reset to Defaults" button in the
  settings section (near the Save button). In `extension/options.js`,
  implement `resetToDefaults()`: restore all storage keys to the hardcoded
  defaults defined in the file, then reload the form. Show a confirmation
  dialog before resetting. Store defaults in a single `DEFAULTS` const object
  for easy maintenance.

- [ ] **T11.15: Add hit count column to rules table**
  In `extension/options.html`, add a "Hits" column to the rules table showing
  how many times each rule has matched. In `extension/options.js`, track hit
  counts in the rules engine (increment on each `findMatchingRule()` match,
  store in `browser.storage.local` under `ruleHitCounts`). Display in the
  table with a reset button to zero all counts. This helps users identify
  which rules are doing the most work.

### Search Page Enhancements

- [ ] **T11.16: Add tab management actions to search page**
  In `extension/search.html` and `extension/search.js`, add per-result action
  buttons: "Close Tab" (sends `browser.tabs.remove`) and "Ungroup" (removes
  tab from its current group via `browser.tabs.ungroup`). Support keyboard
  shortcuts: Ctrl+W to close the focused result, Ctrl+U to ungroup. Add a
  batch-select mode (checkboxes) for closing/ungrouping multiple tabs at once.
  Show a confirmation toast for destructive actions with undo (5s window).

### Polish

- [ ] **T11.17: Add loading spinner to "Suggest Rules from Cache" modal**
  In `extension/options.html`, replace the static "Analyzing cache entries…"
  text with an animated CSS spinner (use the same `.spinner` class from other
  loading states). In `extension/options.js`, show the spinner during the LLM
  call and hide it when results arrive.

### Tests

- [ ] **T11.18: Update tests for Phase 11 changes**
  Run `nix-shell -p nodejs_22` then `npm test`. Update
  `tests/background.test.js` to cover: batch clustering (mock multi-tab LLM
  response), badge fix (verify updateBadge is called not setBadgeText directly),
  source indicators in recent classifications, and _managedGroupIds
  initialization. Ensure all 16 existing tests still pass. Add new tests for
  consolidated utils functions.

### Documentation

- [ ] **T11.19: Update DESIGN.md open questions**
  Remove "LLM-assisted rule creation" (done in Phase 10), "Multi-provider
  support" (done in Phase 10), and "Live cost tracking" (done in Phase 10)
  from the open questions section. Add "Batch tab clustering" as a new
  implemented feature note. Keep "Manifest v3 migration" and "Cross-browser
  support" as deferred.

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.
