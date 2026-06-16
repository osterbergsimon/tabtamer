# TabTamer — Phase 5

## Overview

Phase 5 addresses bugs, performance issues, missing features for power users,
and documentation rot discovered during a full codebase audit. The extension
now has solid core functionality (classification, caching, merging, SPA support),
but several rough edges remain.

Key themes:
- **Correctness**: Fix content script over-injection, startup race condition,
  and history-patching leak on extension reload.
- **Performance**: Use server-side tab query filters instead of filtering all
  tabs in JavaScript; deduplicate the retry-with-backoff logic.
- **Power-user features**: Group color coding, export/import cache, manual
  re-classification via context menu, and a cache dashboard in the options page.
- **UX polish**: Show a processing indicator in the toolbar badge during startup
  scans so users know the extension is working.
- **Documentation**: Fix stale README and BUILD.md content.

## Files to modify

```
extension/
├── manifest.json          # bump version, add contextMenus permission, narrow content script matches
├── background.js           # fix race, deduplicate retry, context menu handler, group colors, processing badge, optimize queries
├── content.js              # cleanup history patching on extension disconnect
├── options.html            # export/import buttons, cache dashboard section
└── options.js              # export/import handlers, cache dashboard logic
README.md                   # fix stale OPENAIC_API_KEY env var reference
BUILD.md                    # fix stale specs/SPEC.md reference
```

## Tasks

- [ ] **T5.1: Narrow content script matches to exclude internal pages**
  Change `manifest.json` content script `matches` from `["<all_urls>"]` to
  `["*://*/*"]` so the script only injects into http/https pages. This
  avoids wasted injections into `about:`, `moz-extension:`, `chrome:`, and
  `file:` URLs where the script has nothing useful to do.

- [ ] **T5.2: Fix startup race — await `loadManagedGroups()` before `startupScan()`**
  In `background.js` `onStartup` handler: add `await` to `loadManagedGroups()`
  so the managed-group ID set is populated before the startup scan runs.
  Without this, SPA navigations inside TabTamer-managed groups can be
  incorrectly skipped during the first few seconds of a browser session.

- [ ] **T5.3: Restore original history methods on content script disconnect**
  In `content.js`: save the original `pushState`/`replaceState` references
  and add a listener for the extension context being invalidated
  (`exportFunction` / port disconnect) that restores them. Without this, a
  reload of the extension leaves the patched history methods in place,
  causing stale message sends and potential errors.

- [ ] **T5.4: Use server-side tab query filters instead of JS filtering**
  In `background.js` `getUngroupedTabs()`: replace `browser.tabs.query({})`
  with `browser.tabs.query({ groupId: -1 })` to return only ungrouped tabs
  directly from the browser API. In `mergeSimilarGroups()`: remove the
  full `browser.tabs.query({})` — instead use `browser.tabs.query({ groupId: g.id })`
  per group when counting tabs, or use `browser.tabGroups.query({})` and
  trust the group metadata. This avoids pulling every tab into memory for
  large sessions (100+ tabs).

- [ ] **T5.5: Deduplicate retry-with-backoff logic**
  Extract the retry loop (exponential backoff, rate-limit handling, max
  attempts) that is duplicated verbatim across `classifyAndAssign()` and
  `mergeSimilarGroups()` into a single `retryWithBackoff(fetchFn, options)`
  utility. Use consistent `MAX_RETRIES` (the constant already exists) in
  both call sites instead of the hardcoded `3` in `mergeSimilarGroups`.

- [ ] **T5.6: Auto-assign colors to new tab groups**
  When creating a new group in `assignToGroup()`, pass a `color` property
  to `browser.tabGroups.create()`. Derive the color deterministically from
  the group name (e.g., hash the name and pick from Firefox's supported
  color list: `grey, blue, red, yellow, purple, pink, green, orange, cyan`).
  Existing groups without colors should get a color assigned on the next
  group merge cycle or via a one-time migration.

- [ ] **T5.7: Export and import domain cache**
  Add an "Export Cache" button and an "Import Cache" button to the options
  page (below the existing "Clear Cache" button). Export downloads the
  `domainGroupCache` as a JSON file. Import reads a JSON file via a hidden
  `<input type="file">`, validates the structure, and merges it into the
  existing cache (prompting the user for overwrite vs. merge via a simple
  confirm dialog). This allows users to back up their cache or transfer it
  between Firefox profiles.

- [ ] **T5.8: Add manual re-classification via right-click context menu**
  Add `contextMenus` to manifest permissions. In `background.js`, create a
  context menu item "Re-classify with TabTamer" visible on tabs (contexts:
  `["tab"]`). On click: remove the tab's domain from the cache and trigger
  a fresh classification via `handleTab()`. This gives users a way to
  override incorrect cached classifications without clearing the entire
  cache.

- [ ] **T5.9: Add cache dashboard to options page**
  Add a new card below "API Usage" in `options.html` titled "Domain Cache"
  that shows a searchable, filterable table of all cached domains and their
  assigned groups. Include a search `<input>` that filters rows by domain
  or group name. Show the count of cached entries. On clicking a row, allow
  editing the group name or deleting the entry. This gives users visibility
  into what the extension has learned and the ability to correct mistakes
  individually.

- [ ] **T5.10: Show processing indicator in toolbar badge during startup scan**
  In `background.js` `startupScan()`: set the badge text to "…" (or a
  spinner-like character) with a neutral color before starting the scan,
  and restore it to the normal group-count badge (via `updateBadge()`) when
  the scan completes. This gives users a visual cue that the extension is
  actively classifying tabs, preventing confusion during the first few
  seconds of a browser session.

- [ ] **T5.11: Fix stale documentation**
  In `README.md` line 8: remove the reference to `OPENAIC_API_KEY`
  environment variable (extensions cannot read environment variables; the
  API key is set via the options page). In `BUILD.md` line 12: change
  `iteratr build --spec specs/SPEC.md` to reference the correct spec file
  (or just say `specs/SPEC.md` since it now exists).

- [ ] **T5.12: Bump manifest version to 1.5.0**
  Update `manifest.json` `version` from `"1.4.0"` to `"1.5.0"`.

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.

## Design notes

### Group color coding (T5.6)
Firefox supports these group colors natively: `grey`, `blue`, `red`,
`yellow`, `purple`, `pink`, `green`, `orange`, `cyan`. Derive a color
from the group name by hashing it and modulo-mapping to the color list.
This ensures the same group name always gets the same color across
sessions, providing visual consistency. The `browser.tabGroups.create()`
and `browser.tabGroups.update()` APIs accept a `color` property.

### Export/import cache (T5.7)
Export format: plain JSON matching the `domainGroupCache` storage key
shape (`{ "domain": "Group Name", ... }`). Import should offer two modes:
- **Merge**: add new entries, skip existing (safe default).
- **Overwrite**: replace the entire cache (prompt confirmation).

### Content script matches (T5.1)
Firefox content script match patterns require a scheme. Using `*://*/*`
covers `http://` and `https://` URLs on any host/port/path. This excludes
`about:`, `moz-extension:`, `data:`, `file:`, and `view-source:` URLs
where SPA navigation detection is irrelevant.

### Cache dashboard (T5.9)
The dashboard is read-only by default with an "edit" mode per row.
Editing a cache entry should update both the cache in storage and, if
the user changes the group name, optionally move existing tabs from the
old group to the new one (prompt the user). Deleting an entry simply
removes the domain→group mapping — future visits will trigger a fresh
LLM classification.
