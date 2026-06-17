# TabTamer — Phase 9

## Overview

Phase 9 is a stability and polish release that fixes 7 bugs, improves 4 code-quality
issues, addresses 8 UX gaps, and ships one v2.0 feature: **Tab Hibernation** — automatic
memory-saving for idle tabs in managed groups. The popup gets per-group tab counts,
cost display, and a loading spinner. The options page gains unsaved-changes warnings
and bulk cache actions. Silent failures are eliminated throughout the pipeline.

## Files to modify

```
extension/
  manifest.json            # bump to 1.9.0, add hibernation alarm permission note
  background.js            # bug fixes, hibernation engine, code quality, UX fixes
  popup.html               # per-group tab counts UI, cost display, wider layout
  popup.js                 # loading spinner, cost display, per-group counts
  options.html             # unsaved-changes warning, bulk cache actions, import/export excluded domains
  options.js               # unsaved-changes tracking, bulk operations, excluded domain import/export
  search.html              # remove hardcoded data-theme="dark", ARIA roles
  search.js                # ARIA roles, filter by group/window
  lib/constants.js         # new constants: hibernation keys, magic string replacement
  lib/utils.js             # no changes
  lib/rules-engine.js      # no changes
  content.js               # no changes
tests/
  setup.js                 # fix resetMocks to call sinon.reset() instead of resetHistory()
  background.test.js       # add hibernation tests
specs/
  SPEC.md                  # this file (replaces Phase 8)
```

## Tasks

- [ ] **T9.0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions, gotchas, and architecture
  notes. Also read `DESIGN.md` for component architecture.

### Bugs (priority: blockers first)

- [ ] **T9.1: Fix fire-and-forget `startupScan()` — unhandled promise rejections**
  `background.js` lines 1130 and 1164: `startupScan()` is called without `await`
  inside `onStartup` and `onInstalled` listeners. The outer try/catch won't catch
  errors from the returned promise, causing silent failures. Add `await` before
  both calls. After adding `await`, wrap each in a try/catch to prevent a
  rejection from blocking the rest of the listener (e.g., `assignColorsToGroups`
  or alarm creation after it).

- [ ] **T9.2: Fix `search.html` hardcoded `data-theme="dark"` flash**
  `search.html` line 1 has `<html lang="en" data-theme="dark">` hardcoded.
  This causes a flash of dark theme before JS loads the user's actual theme
  preference. Remove the hardcoded attribute — default to no `data-theme`
  (falls through to `@media (prefers-color-scheme)` like popup does).
  In `search.js`, read `tabtamerSettings.theme` from storage on init and
  apply `data-theme` attribute, same pattern as `popup.js` lines 193-206.

- [ ] **T9.3: Optimize `isDomainExcluded` from O(n) linear scan to O(1) Set lookup**
  `background.js` lines 518-541: Every tab classification scans the entire
  exclusion list linearly. Split into two data structures:
  - A `Set` for exact-match domains (O(1) lookup)
  - An array for wildcard patterns (`*.domain.com`), which require suffix matching
  Check the Set first; only fall through to the array if not found.
  This significantly reduces overhead when users have many excluded domains.

- [ ] **T9.4: Remove redundant color check in `assignToGroup()`**
  `background.js` lines 669-679: Every group assignment calls
  `browser.tabGroups.get()` + `browser.tabGroups.update()` to ensure the existing
  group has a color. But `assignColorsToGroups()` already handles this on startup,
  and no code path removes a group's color mid-session. This is wasted API calls
  on every single tab grouping. Remove the block (lines 669-679) and the
  associated comment. Keep the `// T4.2: Track this group` comment that follows.

- [ ] **T9.5: Truncate group names list in classification system prompt**
  `background.js` lines 731-733: The classification system prompt includes ALL
  existing group names without truncation. With 50+ groups, the prompt could be
  thousands of characters, wasting tokens and potentially exceeding context limits.
  Cap the existing groups list at 20 names (prioritizing groups with the most tabs).
  Add `...and N more` suffix if truncated. Extract the `20` cap to a constant
  `MAX_GROUP_NAMES_IN_PROMPT` in `lib/constants.js`.

- [ ] **T9.6: Batch tab-count queries in `mergeSimilarGroups`**
  `background.js` lines 920-924: Queries `browser.tabs.query({ groupId: g.id })`
  individually for each group. With 20+ groups, that's 20+ API calls. Replace
  with a single `browser.tabs.query({})` call to get all tabs, then count by
  `groupId` in JavaScript. This reduces N API calls to 1.

- [ ] **T9.7: Fix test mock `resetMocks()` incomplete reset**
  `tests/setup.js` line 91: `sinon.resetHistory()` only resets call history,
  not behavior. If a test changes stub behavior via `.resolves()` and a subsequent
  test doesn't explicitly override it, stale behavior persists. Change to
  `sinon.reset()` which resets both history and behavior. Verify all 16 existing
  tests still pass after this change.

### Code Quality

- [ ] **T9.8: Extract `'tabtamerNotifiedNoApiKey'` to a constant**
  `background.js` uses the magic string `'tabtamerNotifiedNoApiKey'` in 4 places
  (lines 799, 800, 811, 1122). Add `NO_API_KEY_NOTIFIED_KEY` to
  `lib/constants.js` and replace all 4 occurrences. This prevents typos and
  makes the storage key discoverable alongside other constants.

- [ ] **T9.9: Await `browser.storage.local.remove` in `onStartup`**
  `background.js` line 1122: `browser.storage.local.remove('tabtamerNotifiedNoApiKey')`
  (which becomes the constant from T9.8) is fire-and-forget without `await`.
  Add `await` so errors are surfaced properly. This is a non-critical path
  but inconsistent with the rest of the listener.

- [ ] **T9.10: Extract duplicate `_recentClassifications` unshift+pop pattern**
  The `_recentClassifications.unshift(...)` followed by `if (length > MAX_RECENT)
  _recentClassifications.pop()` pattern appears 3 times in `background.js`
  (around lines 440, 485, 780). Extract to a helper function
  `_addRecentClassification(entry)` that handles both the unshift and the
  overflow trim. Replace all 3 call sites.

- [ ] **T9.11: Split `mergeSimilarGroups` into focused sub-functions**
  `background.js` `mergeSimilarGroups()` is ~145 lines. Split into:
  - `_buildMergePrompt(groups, tabCountByGroup)` — builds system + user messages
  - `_parseMergeResponse(response)` — parses LLM JSON response, validates
  - `_applyMerges(mergeMap, groups)` — performs the actual `browser.tabGroups.update`
  Keep `mergeSimilarGroups()` as the orchestrator calling these three helpers.

### UX Fixes & Missing Features

- [ ] **T9.12: Add loading spinner to `popup.js` `showLoading()`**
  `popup.js` line 139-141: `showLoading()` is a no-op. Implement a visible
  loading state: show a CSS spinner in the `loading-state` div (already styled
  in `popup.html` lines 305-314) while state loads. In `loadPopupState()`, call
  `showLoading()` to show the spinner, then `hideLoading()` after render.
  Add `hideLoading()` to clear it.

- [ ] **T9.13: Add per-group tab counts to popup**
  `background.js` `getPopupState()` (lines 270-301) only returns group names,
  not tab counts. In `getPopupState()`, after filtering managed groups, query
  `browser.tabs.query({})` once and count tabs per `groupId`. Return
  `managedGroupTabCounts` — a map of group name → tab count.
  In `popup.js` `renderState()`, display counts alongside group tags:
  `"GitHub (12)"`. In `popup.html` group-tag CSS, ensure the count fits within
  the tag without overflowing.

- [ ] **T9.14: Add cost display to popup footer**
  `background.js` `getPopupState()`: read `tabtamerCosts` from storage and
  include `totalCost` (sum of `totalInputCost + totalOutputCost`) and
  `totalCalls` in the response.
  In `popup.html`, add a cost row in the stats section: "LLM Cost: $0.0012
  (42 calls)". Style it small and muted. In `popup.js` `renderState()`, render
  it. Format cost with up to 4 decimal places (e.g., `$0.0012`).

- [ ] **T9.15: Persist recent classifications to storage**
  `background.js`: `_recentClassifications` is in-memory only — lost on browser
  restart or extension reload. On every update to `_recentClassifications`,
  persist the array to `storage.local` under key `RECENT_CLASSIFICATIONS_KEY`
  (add to `lib/constants.js`). On startup, load it back into memory.
  Cap stored entries at `MAX_RECENT` (5). This makes the popup's "Recent
  Classifications" survive restarts.

- [ ] **T9.16: Notify user on silent LLM classification failure**
  `background.js`: When `retryWithBackoff` exhausts all retries for a
  classification call, the tab is silently left ungrouped. After the final
  retry fails, show a Firefox notification: "TabTamer: Could not classify
  tab — ${domain}. Check your API key and connection." Use
  `browser.notifications.create()` with a unique ID to avoid duplicates.
  Only notify once per session per failure type (track via
  `_lastClassifyFailureNotification` timestamp — suppress repeats within 5 min).

- [ ] **T9.17: Add unsaved-changes warning to options page**
  `options.html` / `options.js`: Track whether any settings field has been
  modified since the last save. On `beforeunload`, if there are unsaved changes,
  show a confirmation dialog: "You have unsaved changes. Leave anyway?"
  Clear the flag after successful save. Track dirty state via a `_isDirty` flag
  set on any input/change event on the settings form and cache dashboard edits.

- [ ] **T9.18: Add bulk delete to cache dashboard + import/export for excluded domains**
  `options.html` cache dashboard: Add a "Select All" checkbox and a "Delete Selected"
  button. Individual rows get checkboxes. Implement multi-select and bulk delete
  in `options.js` by calling `browser.runtime.sendMessage({ type: 'deleteCacheEntries',
  domains: [...] })`. Add corresponding message handler in `background.js`.
  Also add Import/Export buttons for the excluded domains list (reuse the existing
  import/export pattern already used for cache and rules).

### Big Feature: Tab Hibernation

- [ ] **T9.19: Tab Hibernation Engine**
  Implement automatic discarding of idle tabs in TabTamer-managed groups:

  **Storage**: Add `tabtamerLastAccess` key in `lib/constants.js` — a map of
  `tabId → lastAccessTimestamp`. Only track tabs in managed groups.

  **Tracking**: In `background.js`, add a `tabs.onActivated` listener that
  updates `tabtamerLastAccess[activeInfo.tabId] = Date.now()`. Also update on
  `tabs.onUpdated` when a tab's URL changes (the user navigated within the tab).
  Persist to `storage.local` on each update (throttled to once per 30 seconds
  to avoid storage write storms).

  **Periodic hibernation alarm**: Create a new alarm `tabtamer-hibernate`
  (every 10 minutes). In the handler:
  1. Load settings for `hibernateAfterMinutes` (new setting: 15, 30, 60, or
     "never" — default 30). If "never", return early.
  2. Query all tabs in managed groups: `browser.tabs.query({})` filtered to
     tabs whose `groupId` is in `_managedGroupIds`.
  3. Skip: pinned tabs, audible tabs, the active tab in each window, and tabs
     accessed within `hibernateAfterMinutes`.
  4. Call `browser.tabs.discard(ids)` — bulk discard idle tabs. Log count.
  5. Update badge to show hibernated tab count (e.g., "💤12").

  **Settings UI**: In `options.html`, add a "Tab Hibernation" section:
  - Dropdown: "Discard idle tabs after" → [15 min, 30 min (default), 60 min, Never]
  - Per-group opt-out: in the cache dashboard, add a "No Hibernate" checkbox
    per cache entry. Persist to `tabtamerHibernateOptOut` (array of group names).
  - Hibernation respects the opt-out list.

  **Popup display**: In `popup.html` stats section, add "Hibernated: 12 tabs"
  row when count > 0. In `getPopupState()`, query storage for hibernated count.

  **Permissions**: No new permissions needed — `tabs.discard` is covered by
  the existing `tabs` permission.

### Documentation

- [ ] **T9.20: Update DESIGN.md and TESTING.md**
  - `DESIGN.md`: Add Tab Hibernation section (storage keys, alarm, tracking
    flow). Update "Resolved questions" to note hibernation.
  - `TESTING.md`: Add test procedures: Hibernation tracking (Test 19), idle
    discard (Test 20), per-group opt-out (Test 21), unsaved-changes warning
    (Test 22), bulk cache delete (Test 23).

### Bump version

- [ ] **T9.21: Bump manifest version to 1.9.0**
  Update `"version"` in `extension/manifest.json` from `"1.8.0"` to `"1.9.0"`.

### Meta

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.

## Design notes

### Tab Hibernation

Hibernation uses Firefox's built-in `tabs.discard()` API — the tab is unloaded
from memory but remains in the tab strip. Clicking it reloads the page. This is
the same mechanism Firefox uses for its built-in "unload inactive tabs" feature,
but TabTamer makes it group-aware and user-configurable.

**Why not `tabs.hide()`?** `hide()` is a different feature that removes tabs
from the tab strip (used by extensions like OneTab). Discarding preserves the
tab's position in the group while freeing memory.

**Storage throttling**: `tabtamerLastAccess` is written at most once per 30
seconds to avoid `storage.local` write storms during rapid tab switching.
The in-memory copy is always up-to-date; storage is a best-effort persistence.

### isDomainExcluded optimization

The split approach: a `Set` for exact matches gives O(1) lookup for the common
case. Wildcard patterns (`*.example.com`) are rare and still use the linear
suffix check. This avoids the complexity of a full trie or regex engine.

### System prompt group name cap

With 50+ group names averaging 8 chars each, the existing groups list alone
would be 400+ chars. Capping at 20 keeps the prompt under ~200 chars for the
list while still giving the LLM enough context. Groups with more tabs are
prioritized since they're more likely to be reused.

### mergeSimilarGroups refactor

The split is mechanical — no behavior change. `_buildMergePrompt` handles
the system+user message construction. `_parseMergeResponse` validates the JSON
shape and maps group titles to IDs. `_applyMerges` performs the actual group
updates. Each function has clear inputs/outputs for testability.
