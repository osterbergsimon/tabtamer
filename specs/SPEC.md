# TabTamer — Phase 8

## Overview

Phase 8 is a bug-fix and UX polish release that also ships two v2.0 features:
a **Smart Tab Search** command palette and **Group Color Customization**.
Seven bugs are fixed — including the critical `browser.windows` permission
gap and merge-respects-manual-groups regression. The popup gains theme
awareness, and the codebase drops dead code.

## Files to modify

```
extension/
  manifest.json            # add "windows" permission, bump to 1.8.0
  background.js            # bug fixes, dead code removal, recent tracking
  popup.html               # theme-aware CSS
  popup.js                 # theme loading, quick-switcher trigger
  options.html             # group color picker in cache dashboard, stats dashboard tab
  options.js               # color persistence, stats loading, quick-switcher keyboard shortcut
  lib/constants.js         # new constants for maxRecent, maxTokens, new storage keys
  lib/utils.js             # no changes
  lib/rules-engine.js      # no changes
  content.js               # no changes
specs/
  SPEC.md                  # this file (replaces Phase 7)
```

## Tasks

- [ ] **T8.0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions, gotchas, and architecture
  notes. Also read `DESIGN.md` for component architecture.

### Bugs (priority: blockers first)

- [ ] **T8.1: Add missing `"windows"` permission to manifest.json**
  `options.js` line 369 calls `browser.windows.getAll({ populate: false })`
  when creating a target group after cache rename, but `"windows"` is not
  in `manifest.json` permissions. This call always fails silently.
  Add `"windows"` to the permissions array. This is a runtime bug.

- [ ] **T8.2: `mergeSimilarGroups()` must respect `_managedGroupIds`**
  `background.js` line 852: `const groups = await browser.tabGroups.query({});`
  queries ALL groups, including ones manually created by the user.
  Filter to only TabTamer-managed groups (those whose ID is in
  `_managedGroupIds`). This prevents accidentally merging user's own groups.
  Similarly, filter `assignColorsToGroups()` (line 977) to only managed groups.

- [ ] **T8.3: Remove dead `_startupInProgress` flag**
  `background.js` line 27: `let _startupInProgress = false;` is declared
  but never set to `true` or read anywhere. Remove it and the associated
  comment to keep the codebase clean.

- [ ] **T8.4: Track recent classifications for cache hits and rule matches**
  `background.js` lines 724-732: `_recentClassifications` is only updated
  in `classifyAndAssign()`. Cache hits and rule matches don't appear in
  the popup's "Recent Classifications" list, making the popup look stale.
  Add `_recentClassifications.unshift(...)` calls in the cache-hit path
  (after `getCachedGroup` match) and the rule-match path (after
  `TabTamerRules.matchRules` match), using the same format as line 725-728.
  Also extract the magic number `5` to a constant `MAX_RECENT` in
  `lib/constants.js`.

- [ ] **T8.5: `await` the `assignColorsToGroups()` call in startup listeners**
  `background.js` lines 1060 and 1089: `assignColorsToGroups();` is called
  without `await`. While idempotent, errors are silently swallowed. Add
  `await` so failures appear in the console for debugging.

- [ ] **T8.6: Retry 401/403 errors immediately without backoff**
  `background.js` `retryWithBackoff()` lines 55-63: non-429 errors (including
  401/403 auth failures) retry with exponential backoff, which wastes time
  and looks like a network issue. If the response status is 401 or 403,
  log the error and return `null` immediately — do not retry. Auth errors
  won't resolve on their own.

- [ ] **T8.7: Increase `max_tokens` for classification from 20 to 30**
  `background.js` line 696: `max_tokens: 20` is tight for 3-word group
  names with longer words (e.g., "Machine Learning"). Increase to 30.
  Extract to a constant `CLASSIFY_MAX_TOKENS` in `lib/constants.js`.

### UX polish

- [ ] **T8.8: Make popup respect user theme setting**
  `popup.html` only uses `@media (prefers-color-scheme: dark)` for dark
  mode, ignoring the user's explicit theme choice from options (system/light/dark).
  In `popup.js`, on DOMContentLoaded, read `tabtamerSettings.theme` from
  storage and set `document.documentElement.setAttribute('data-theme', theme)`
  like options.html does. Add `:root[data-theme="light"]` and
  `:root[data-theme="dark"]` CSS blocks to `popup.html` (copy-paste
  the approach from options.html).

- [ ] **T8.9: Add "Classify This Tab" button to popup**
  `popup.html` / `popup.js`: Add a button in the popup that sends a
  `spaNavigate`-style message to the background to trigger classification
  of the currently active tab. Query `browser.tabs.query({ active: true,
  currentWindow: true })` to get the tab, then call
  `browser.runtime.sendMessage({ type: 'classifyNow', tabId, url, title })`.
  In `background.js`, listen for `classifyNow` messages and call
  `runWithConcurrencyLimit(() => handleTab(tabId, url, title))`.

### Big new features

- [ ] **T8.10: Smart Tab Search (Quick Switcher)**
  Implement a command-palette-style tab switcher:
  - Add a new keyboard shortcut `Ctrl+Shift+K` (or `Ctrl+Shift+Space`) in
    `manifest.json` under `commands` with id `tabtamer-search`.
  - In `background.js`, listen for the command and open a new tab or popup
    with a search UI (`search.html` + `search.js`).
  - The search UI lists all open tabs (title, URL, group name) with
    fuzzy-search filtering as the user types.
  - Pressing Enter switches to the selected tab and closes the search UI.
  - Use `browser.tabs.query({})` to get all tabs and `browser.tabGroups.query({})`
    to map group IDs to names.
  - Style the search UI to match the options page theme (light/dark aware).
  - Add search UI files: `extension/search.html`, `extension/search.js`.

- [ ] **T8.11: Group Color Customization**
  Allow users to override the deterministic color for any group:
  - Add a new storage key `tabtamerGroupColors` (in `lib/constants.js`)
    mapping group name → color (e.g. `{"GitHub": "blue", "Email": "purple"}`).
  - In `background.js` `getGroupColor()`: check `tabtamerGroupColors` first;
    if the group name has a custom color, use it. Otherwise fall back to
    the djb2 hash.
  - In `options.html` cache dashboard: add a color picker (dropdown with
    the 9 Firefox group color options: grey, blue, red, yellow, purple,
    pink, green, orange, cyan) next to each cache entry. When changed,
    persist to `tabtamerGroupColors`.
  - In `options.js`: load/save `tabtamerGroupColors`, render pickers in
    cache rows.
  - When a group is renamed in the cache, migrate the custom color to the
    new name.

### Documentation

- [ ] **T8.12: Update DESIGN.md and TESTING.md**
  - `DESIGN.md`: Add Smart Tab Search and Group Color Customization sections.
    Mark "Open questions → Manifest v3 migration" as deferred (tracked
    separately, not in this phase).
  - `TESTING.md`: Add test procedures for quick switcher (Test 16), group
    color customization (Test 17), and popup classify-this-tab button (Test 18).

### Bump version

- [ ] **T8.13: Bump manifest version to 1.8.0**
  Update `"version"` in `extension/manifest.json` from `"1.7.0"` to `"1.8.0"`.

### Meta

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.

## Design notes

### Smart Tab Search
The search UI opens as a browser action popup alternative (or a dedicated
page). It shows a text input at the top and a scrollable list of matches
below. Each row shows: tab title, URL (truncated), group name tag (colored).
Fuzzy matching via simple substring matching (no library needed — the
search space is small, ~hundreds of tabs).

### Group Color Customization
Storage key `tabtamerGroupColors` is a flat object `{ "Group Name": "color" }`.
Colors are the 9 Firefox-supported tab group colors. The color picker in
the cache dashboard is a `<select>` dropdown showing color names with
inline color swatches (use CSS `background-color` on options or a custom
dropdown with colored dots).

### mergeSimilarGroups safety
The fix in T8.2 ensures `mergeSimilarGroups` only operates on groups whose
IDs are in `_managedGroupIds`. If `_managedGroupIds` is `null` (loaded
failed), skip the merge entirely rather than risking user groups.
