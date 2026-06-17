# TabTamer — Phase 7

## Overview

Phase 7 is a broad polish and ambition release. Eight bugs — including race
conditions, silent failures, and stale data — are fixed. The two headline
features make TabTamer dramatically more useful for daily workflow: a **custom
group rules engine** that lets users pin domain→group mappings (skipping the
LLM entirely for known sites), and a **toolbar popup** for quick actions,
group stats, and the long-missing "what's happening right now" visibility.

Beyond features, this phase extracts shared constants and utilities into
proper modules (ending the duplication between background and options pages),
replaces blocking `confirm()` dialogs with inline modals, and fixes the badge
to show only TabTamer-managed groups. Documentation gets a long-overdue
refresh: the README describes all features, DESIGN.md corrects factual errors,
and security-conscious users gain documentation for alternative LLM endpoints.

## Files to modify

```
extension/
├── manifest.json              # bump version to 1.7.0; add connect-src CSP
├── background.js               # fix 8 bugs; extract shared code to modules
├── content.js                  # fix monkey-patch fragility
├── options.html                # inline modals, sections/tabs, rules engine UI
├── options.js                  # shared constants import, rules engine logic
├── popup.html                  # NEW: toolbar popup page
├── popup.js                    # NEW: popup logic
├── lib/
│   ├── constants.js            # NEW: shared storage keys, magic numbers, API URL
│   ├── utils.js                # NEW: shared extractDomain, sleep, normalizeGroupName
│   └── rules-engine.js         # NEW: custom group rules matching
├── README.md                   # document all features
├── DESIGN.md                   # fix false claims, update cost estimates
└── TESTING.md                  # add tests for new features
```

## Tasks

- [ ] **T7.0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions: test environment (nix-shell),
  mock quirks, naming gotchas (`normalizeGroupName`), and architecture notes.
  Also read `DESIGN.md` for component architecture.

### Bugs (blockers first)

- [ ] **T7.1: Fix race condition in `assignToGroup` — tab can close between `get` and `create`**
  In `background.js` `assignToGroup()`, the inner `browser.tabs.get(tabId)` at
  line ~581 (inside the `else` branch for new group creation) is not wrapped
  in try/catch. If the tab is closed after the outer guarded check succeeds
  but before this inner `get`, an uncaught exception propagates. Wrap the
  inner `get` call in try/catch; if it throws (tab gone), return silently.

- [ ] **T7.2: Fix cost undercounting for empty/parseable LLM responses**
  In `background.js` `classifyAndAssign()` around line 687-689, when the LLM
  response is OK but the group name is empty/falsy, the function returns
  without calling `updateCosts()`. Tokens were consumed and billed by the API
  but not tracked locally. Call `updateCosts()` before the early return.

- [ ] **T7.3: Fix stale overwrite count in `importCache`**
  In `background.js` `handleCacheFileSelected()` around line 514-517, the cache
  is read a second time inside a template literal for the `confirm()` dialog.
  Between the merge-decision read and this confirm read, another operation
  could have modified the cache, making the count shown to the user incorrect.
  Cache the count from the first read and use the cached value in the message.

- [ ] **T7.4: Fix `loadManagedGroups` silent failure that disables all processing**
  In `background.js`, if `browser.storage.local.get(MANAGED_GROUPS_KEY)` fails
  (line ~361 area), `_managedGroupIds` stays an empty Set. Then in `handleTab`,
  ALL tabs already in ANY group are treated as "manually managed" and skipped.
  TabTamer would silently stop processing tabs in groups entirely. Add a
  try/catch around the load; on failure, treat as "no managed groups known"
  and log a warning rather than silently defaulting to an empty set.

- [ ] **T7.5: Fix `content.js` monkey-patch fragility for `history.pushState`/`replaceState`**
  If another extension also monkey-patches these, or if the TabTamer extension
  is reloaded without a page refresh, the patches can break. Add a guard:
  store the original function reference once (before any patching); if already
  patched, don't double-patch. When the port disconnects, only restore if the
  current function is our wrapper. Also handle the case where
  `browser.runtime.connect` fails (e.g., background not ready) by retrying
  with exponential backoff or accepting that patching cannot be restored and
  logging a warning.

- [ ] **T7.6: Fix stale title in `onUpdated` listener**
  The `tabs.onUpdated` listener captures `tab.title` from the event closure,
  but during page loading Firefox may show the URL or an empty string as the
  title. Add a small delay (300ms) after `status === 'complete'` and then
  re-read `browser.tabs.get(tabId)` to capture the final title before
  passing it to the LLM prompt.

- [ ] **T7.7: Strengthen excluded domain validation**
  In `options.js` `saveExcludedDomains()`, currently only rejects entries
  containing spaces. A user could enter `https://github.com/some/path`
  which would never match because `isDomainExcluded` does exact/suffix
  domain matching. Validate that entries look like bare domains (no scheme,
  no path, no port). Show inline validation errors rather than silently
  accepting invalid entries.

- [ ] **T7.8: Suppress `notifyMissingApiKey` during startup scan**
  In `background.js`, `onStartup` clears the notification flag
  (`tabtamerNotifiedNoApiKey = false`), then `startupScan` runs. If the API
  key is missing, the notification fires immediately before the user has a
  chance to set it. The user sees a notification on every browser restart.
  Add a `_startupInProgress` flag; don't fire the missing-API-key notification
  while the startup scan is running. Fire it only after startup scan completes
  if the key is still missing and no tabs were classified.

### Missing features & feature gaps

- [ ] **T7.9: Implement custom group rules engine (v2.0 headline feature)**
  Create `lib/rules-engine.js`. Users can define domain→group rules with glob
  patterns. Example rules:
  - `github.com/*` → "Code"
  - `*.internal.corp` → "Work"
  - `mail.google.com` → "Email"
  
  Rules have priority ordering (first match wins). When a tab navigates,
  check rules BEFORE calling the LLM. A matching rule skips the LLM entirely,
  saving costs and latency. Rules are stored in `browser.storage.local` under
  a `RULES_KEY`. Add UI to options page for adding/removing/reordering rules
  with a simple table: domain pattern, group name, enabled toggle. Import/
  export of rules supported alongside cache import/export.

- [ ] **T7.10: Implement toolbar popup (v2.0 headline feature)**
  Create `popup.html` and `popup.js` — a lightweight toolbar popup that opens
  when the browser action icon is clicked. Features:
  - Pause/Resume toggle (big, prominent button)
  - TabTamer-managed group count with list of group names
  - Last 5 classified tabs (domain → group, with timestamp)
  - Quick link to open full options page
  - Processing indicator (spinner/badge) when classification is active
  
  Set `browser_action.default_popup` in manifest.json to `popup.html`.
  The popup communicates with the background script via `browser.runtime.sendMessage`.

### UX polish

- [ ] **T7.11: Replace blocking `confirm()` dialogs with inline modals**
  In `options.html`/`options.js`, the cache dashboard edit, save, and delete
  actions use `window.confirm()` which blocks the UI and looks dated. Replace
  with a lightweight inline modal component: a semi-transparent overlay with
  a confirmation dialog inside. The modal should be reusable (create a
  `showConfirmModal(message)` function that returns a Promise).

- [ ] **T7.12: Add visual feedback during classification**
  The badge currently shows "OFF" or group count, but there's no indicator
  when tabs are being actively classified. Add a "processing" badge state:
  show "..." or a small spinner icon while classifications are in-flight.
  Update `updateBadge()` to accept a `processing` flag. Track pending
  classification count and show badge text like "3…" when 3 tabs are
  being classified.

- [ ] **T7.13: Fix badge to show only TabTamer-managed groups**
  `updateBadge()` in `background.js` queries ALL tab groups (including
  manual ones) and sets the badge to the total count. The count is misleading.
  Change to query only groups whose IDs are in `_managedGroupIds`, so the
  badge reflects only TabTamer-managed group count.

- [ ] **T7.14: Options page — add sections/tabs for navigation**
  The options page is one long scroll with API key, model, theme, cache
  dashboard, excluded domains, shortcuts, and costs all stacked vertically.
  Split into collapsible sections or horizontal tabs:
  - **General**: API key, model, theme, pause toggle
  - **Rules**: custom group rules table (from T7.9)
  - **Cache**: cache dashboard (search, edit, delete, import/export)
  - **Privacy**: excluded domains list
  - **Info**: version, costs, keyboard shortcuts

- [ ] **T7.15: Configurable toast dismiss time & exclude count**
  Increase default toast dismiss from 3s to 5s for import results (so users
  can read counts). Show excluded domain count as a badge on the "Excluded
  Domains" section header.

### Code quality

- [ ] **T7.16: Extract shared constants to `lib/constants.js`**
  `SETTINGS_KEY`, `CACHE_KEY`, `COSTS_KEY`, `EXCLUDED_DOMAINS_KEY`,
  `MANAGED_GROUPS_KEY`, `RULES_KEY` are defined in both `background.js` and
  `options.js`. Extract all storage keys, magic numbers (badge debounce 500ms,
  search debounce 200ms, toast dismiss 3000ms → 5000ms), the API endpoint URL,
  `MAX_CONCURRENT`, `MERGE_INTERVAL_MIN`, and token limits to `lib/constants.js`.
  Import in both background and options pages.

- [ ] **T7.17: Extract shared utilities to `lib/utils.js`**
  `extractDomain()`, `sleep()`, `normalizeGroupName()`, and the acronym list
  are duplicated or only in background.js. Extract to `lib/utils.js` so the
  options page can use them for input validation (e.g., domain extraction
  when adding exclusion rules). Also fix `normalizeGroupName` to do
  case-insensitive acronym matching — if the LLM returns "api" (lowercase),
  it should still become "API".

- [ ] **T7.18: Fix empty catch in `isEnabled()` — don't silently default to `true`**
  In `background.js` `isEnabled()` (line ~527-529), an empty catch block
  silently swallows ALL errors and defaults to `true` (enabled). This could
  mask storage corruption or quota errors. Log the error and return a
  sensible default, or re-throw critical errors. At minimum, add a
  `console.warn()` with the error details.

### Documentation

- [ ] **T7.19: Update DESIGN.md — fix false claims and outdated cost estimates**
  - Remove "Cache is cleared when the extension updates" (it's not implemented).
    Replace with: "Cache persists across updates. To clear, use the cache
    dashboard in options or manually clear extension storage."
  - Update cost estimate from "~200 tokens" to reflect actual constants:
    "~150 tokens for classification, ~500 tokens for merge operations."
  - Add section on custom rules engine (T7.9) and how it bypasses the LLM.
  - Add section on the toolbar popup architecture.

- [ ] **T7.20: Update README.md — document all features**
  The current README is sparse. Expand to describe: auto-grouping, custom
  rules, excluded domains, cost tracking, cache dashboard, keyboard shortcuts,
  SPA support, group merging, startup scan, toolbar popup, and the cache
  import/export feature. Add a "Privacy" section about domain exclusions
  and the content script's scope.

- [ ] **T7.21: Add documentation for custom LLM endpoints**
  The opencode.ai endpoint is hardcoded. Add a section to README.md explaining
  how to modify the endpoint in `lib/constants.js` for self-hosted or
  alternative OpenAI-compatible providers (e.g., Ollama, LocalAI, LiteLLM).
  Note that the manifest's `host_permissions` must also be updated.

### Meta

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.

## Design notes

### Custom rules engine (`lib/rules-engine.js`)

- Rules stored as an ordered array: `[{ pattern, groupName, enabled }]`.
- Matching: convert glob to regex. `*` → `.*`, `?` → `.`. Exact domain
  matches if no glob characters. Always anchored (full domain match).
- Priority: first matching enabled rule wins.
- Called in `handleTab()` before the cache check or LLM call.
- Rules UI: a table in options page under the "Rules" tab. Inline add/delete.
  Drag to reorder (bonus, can skip for v1 of this feature).
- Export: rules included in the JSON cache export/import file alongside
  domain cache entries.

### Toolbar popup (`popup.html`)

- Lightweight: under 10KB total. No external dependencies.
- Communicates with background via `browser.runtime.sendMessage`:
  - `{ type: 'getPopupState' }` → returns pause state, managed group count,
    recent classifications, processing count.
  - `{ type: 'togglePause' }` → toggles pause and returns new state.
- Background script adds a `onMessage` listener for these new message types.
- Popup auto-refreshes state when opened (no persistent connection needed).

### CSP hardening

Add `connect-src https://opencode.ai/*` to the manifest's
`content_security_policy` for defense-in-depth. This doesn't change behavior
(the narrow `host_permissions` already limits this) but adds a layer of
protection against future manifest changes inadvertently broadening access.

### Version bump

Manifest version: `1.6.0` → `1.7.0`
