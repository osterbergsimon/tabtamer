# TabTamer — Phase 12

## Overview

Phase 12 is the **content intelligence** release. We ship content-based
classification — the #1 differentiator from DESIGN.md that lets the LLM read
actual page content (headlines, headings, visible text) and group by *topic*
instead of just domain. Cross-domain grouping becomes real: docs site + GitHub
repo + StackOverflow thread all land in the same group because the LLM
understands they're about the same project.

Alongside this headline feature: we fix three bugs (CSP silently blocking
custom endpoints, redundant storage reads in startup scan, missing cache on
endpoint/model resolution), close critical feature gaps (Scan Now action,
Promote to Rule from cache dashboard, Export All Settings backup, batch cache
operations), and polish rough UX edges (theme flash on popup/search, inline
styles, loading indicators on options tabs, tooltips).

The theme: **the LLM finally reads the page, and the extension feels complete.**

## Files to modify

```
extension/
├── manifest.json              (bump 1.11.0 → 1.12.0, relax CSP for custom endpoints)
├── background.js              (content extraction pipeline, isEnabled caching,
│                               resolveEndpoint/resolveModel caching, Scan Now handler,
│                               classification feedback notification)
├── content.js                 (extract page content: title, h1, visible text;
│                               throttle SPA messages)
├── lib/constants.js           (extract CSP_ALLOWED_HOSTS for validation, add
│                               RULE_SUGGESTION_TIMEOUT_MS constant)
├── options.html               (inline style cleanup on model input, promote-to-rule
│                               button per cache row, export-all-settings button,
│                               batch-select cache rows, tab-switch loading spinners)
├── options.js                 (promote-to-rule logic, export-all-settings, batch
│                               cache delete/export, tab-switch loading state,
│                               move suggest-rules button above cache table)
├── popup.html                 (Scan Now button, tooltips on group tags, remove
│                               redundant refresh button styling)
├── popup.js                   (Scan Now action, tooltip rendering, theme flash fix)
├── search.html                (theme flash fix via inline blocking script)
├── search.js                  (theme flash fix)
└── tests/
    └── background.test.js     (content extraction, isEnabled caching, promote-to-rule)
```

## Tasks

### Read conventions

- [ ] **T12.0: Read AGENTS.md and DESIGN.md**
  Read `AGENTS.md` for project conventions, gotchas (normalizeGroupName, local
  keyword, test environment quirk with Node.js/nix-shell), and architecture notes.
  Read `DESIGN.md` sections 11 (Content-Based Classification) and 12 (Group
  Splitting) for feature design context.

### Bugs

- [ ] **T12.1: Fix CSP blocking custom API endpoints silently**
  In `extension/manifest.json`, the `content_security_policy` field restricts
  `connect-src` to `https://opencode.ai/* https://openrouter.ai/*
  https://api.together.xyz/* http://localhost:11434/*`. When a user selects
  the "Custom" provider preset and enters an arbitrary endpoint URL not in this
  list, `fetch()` calls fail silently with a CSP violation — no error explains
  to the user why their custom endpoint doesn't work.
  
  **Fix**: Broaden `connect-src` to `https://*/* http://localhost:*/*` since
  a user explicitly choosing a custom endpoint has opted into connecting there.
  This is a user-initiated action, not an extension-initiated one. Additionally,
  in `extension/lib/constants.js`, add a `CSP_ALLOWED_HOSTS` array and in
  `extension/options.js` validate that custom endpoint URLs entered by the user
  use `https://` (or `http://localhost`), showing an inline validation error
  otherwise. This catches misconfigurations at input time rather than at runtime.

- [ ] **T12.2: Cache `isEnabled()` result during startup scan**
  In `extension/background.js`, `_classifyTabPreLLM()` (line 352) calls
  `isEnabled()` for every ungrouped tab during `startupScan()`. For 40–50 tabs
  this is 40–50 `browser.storage.local` reads. Since the enabled state cannot
  change during a single startup scan, read it once at the top of
  `startupScan()` and pass it as a parameter through
  `_classifyTabPreLLM(tabId, url, title, isEnabled)`. Add a default parameter
  so standalone callers (e.g., right-click classify) still call `isEnabled()`
  internally. This eliminates up to N−1 redundant storage reads per startup.

- [ ] **T12.3: Cache `resolveEndpoint()`/`resolveModel()` per session**
  In `extension/lib/constants.js`, `resolveEndpoint()` and `resolveModel()`
  are called on every classification (potentially multiple times per tab during
  retry loops). Settings rarely change during a session. Add a lightweight
  cache: store the last-seen settings object (by reference or deep-compare of
  the relevant keys) and return the cached result if settings haven't changed.
  Export a `clearEndpointCache()` function called from `extension/options.js`
  when the user saves new settings. This eliminates redundant storage reads
  and string resolution during burst classifications.

### Feature: Content-Based Classification

- [ ] **T12.4: Extract page content in content script**
  In `extension/content.js`, add a new message handler for `extractContent`
  requests. When the background sends `{ type: 'extractContent' }`, the content
  script responds with:
  ```json
  {
    "title": "document.title",
    "h1": "first <h1> text content (trimmed)",
    "text": "first ~500 chars of visible text from <article>, <main>, or <body>"
  }
  ```
  Text extraction: walk the DOM from `<article>` or `<main>` (fallback to
  `<body>`), collect `textContent` from visible (non-`display:none`,
  non-`visibility:hidden`) text nodes, skip `<nav>`, `<footer>`, `<aside>`,
  `<script>`, `<style>` elements. Cap at 500 characters. Trim whitespace.
  Return all fields as strings (empty string if not found).

- [ ] **T12.5: Add content-aware classification pipeline**
  In `extension/background.js`, add a new function
  `classifyWithContent(tabId, url, title, domain)` that:
  1. Checks a new preference `contentClassificationEnabled` (default: `true`
     for new installs, stored in settings)
  2. If disabled or tab matches a rule, skips content extraction (falls through
     to existing `classifyAndAssign`)
  3. Sends `{ type: 'extractContent' }` to the tab's content script via
     `browser.tabs.sendMessage(tabId, ...)` with a 3-second timeout
  4. If content extraction fails or times out, falls back to URL-only
     classification gracefully
  5. If content is extracted, enriches the LLM user message:
     ```
     URL: ${url}
     Title: ${title}
     Page heading: ${h1}
     Page content: ${text}
     ```
  6. The system prompt should bias toward TOPIC/PROJECT names rather than
     domain names when content is available. Add to system prompt:
     "If page content is provided, classify by TOPIC or PROJECT, not by domain.
     Different domains about the same project should get the same group name."
  7. Caching remains domain-based — the content informs the classification
     but the result is still keyed on domain.

  Wire `classifyWithContent` into `handleTab()` and `batchClassifyTabs()`
  (for individual fallback). For batch clustering, content extraction happens
  per-tab before the batch LLM call.

- [ ] **T12.6: Add content classification toggle in options**
  In `extension/options.html`, add a checkbox in the General tab under the
  "Enabled" toggle: "Content-based classification — extract page text for
  smarter topic grouping (sends page content to the LLM)". Bind to
  `contentClassificationEnabled` in settings. In `extension/options.js`,
  add the setting to the save/load cycle with a `DEFAULTS` entry. In
  `extension/background.js`, read this setting and pass to the classification
  pipeline.

### Feature: Rule Creation Improvements

- [ ] **T12.7: Add "Promote to Rule" button per cache row**
  In `extension/options.html`, add a "Promote" button (⚡ icon or "→ Rule"
  text) to each cache dashboard row. In `extension/options.js`, implement
  `promoteToRule(domain, groupName)`: add a new rule with `pattern: domain`,
  `groupName`, `enabled: true` via `TabTamerRules.addRule()`. Show a brief
  toast: "Rule created: ${domain} → ${groupName}". The row's promote button
  should become disabled or hidden after promotion (track in a local Set
  during the session). If a rule already exists for that domain, show the
  button in a "already a rule" disabled state with a tooltip.

- [ ] **T12.8: Move "Suggest Rules from Cache" button above cache table**
  In `extension/options.html`, relocate the `#suggest-rules-btn` from below
  the cache dashboard divider to a more prominent position above the cache
  table, next to the Import/Export buttons. Add a subtitle: "Let the LLM
  review your cache and suggest permanent rules." This makes the most powerful
  cache action immediately visible.

### Feature Gaps

- [ ] **T12.9: Add "Scan Now" action to popup**
  In `extension/popup.html`, add a "Scan Now" button next to the "Classify
  Tab" button (or as a secondary action in the header). In
  `extension/popup.js`, wire the button to send
  `{ type: 'startupScan' }` to the background. In `extension/background.js`,
  add a `runtime.onMessage` handler for `startupScan` that calls
  `startupScan()` (which already exists). Send progress updates back to the
  popup via the existing `startupProgress` message channel. Show a progress
  bar in the popup while the scan runs (reuse the existing
  `#startup-progress-bar` element). When complete, refresh the popup state.

- [ ] **T12.10: Add "Export All Settings" backup**
  In `extension/options.html`, add an "Export All Settings" button in a
  visible location (e.g., in the General tab or as a toolbar action).
  In `extension/options.js`, implement `exportAllSettings()`: collect all
  relevant storage keys (`tabtamerSettings`, `tabtamerCache`,
  `tabtamerRules`, `tabtamerRuleHitCounts`, `tabtamerGroupColors`,
  `tabtamerCosts`, `tabtamerHibernateOptOut`, `tabtamerExcludedDomains`)
  into a single JSON object, stringify with indentation, and download as
  `tabtamer-all-settings-YYYY-MM-DD.json`. Show toast on success.

  Add "Import All Settings" button adjacent: accepts a JSON file in the
  same format, validates structure, and writes all keys to storage. Show
  a confirmation modal before overwriting: "This will replace ALL your
  settings, rules, cache, colors, and cost data. Continue?"

- [ ] **T12.11: Add batch operations to cache dashboard**
  In `extension/options.html`, add checkboxes to cache dashboard rows
  (leftmost column) and a select-all checkbox in the header. Add a batch
  toolbar that appears when ≥1 checkbox is checked with actions:
  "Delete Selected" and "Export Selected". In `extension/options.js`,
  implement batch delete (confirmation modal with count) and batch export
  (downloads JSON of selected entries only). Use the same pattern as the
  rules table batch operations. After batch delete, refresh the cache
  table.

### UX Polish

- [ ] **T12.12: Fix flash of unstyled theme on popup and search pages**
  Both `extension/popup.js` (line 322–334) and `extension/search.js`
  (line 31–44) load the theme asynchronously via
  `browser.storage.local.get()` during `DOMContentLoaded`, causing a
  visible flash from light theme → dark theme (or vice versa).

  **Fix**: In `extension/popup.html` and `extension/search.html`, add a
  blocking `<script>` tag before the `<style>` tag that reads the theme
  from `browser.storage.local` synchronously… except
  `browser.storage.local.get()` is async. Instead: store the theme in a
  fast-access location. Use `browser.storage.local` but also set a
  `data-theme` attribute on `<html>` via a small inline `<script>` that
  calls `localStorage` — mirror the theme to `localStorage` whenever it's
  saved in `extension/options.js`. Then the popup/search can read
  `localStorage.getItem('tabtamerTheme')` synchronously before first
  paint, eliminating the flash. Fall back to `'system'` if not set.

  Update `extension/options.js` to mirror theme to
  `localStorage.setItem('tabtamerTheme', theme)` on every save. Update
  `extension/popup.js` and `extension/search.js` to read the async
  storage value as the canonical source (for correctness) but use the
  synchronous localStorage value to prevent the flash.

- [ ] **T12.13: Remove inline styles from model input field**
  In `extension/options.html`, the model `<input>` (~line 585) has a
  `style` attribute duplicating CSS from the `input[type="text"]` rule.
  Remove the `style` attribute. If any style is missing without it,
  update the CSS selector to cover the model input specifically.

- [ ] **T12.14: Add loading spinners to options page tab switches**
  In `extension/options.html`, add a `<div class="spinner">` inside each
  tab panel that shows while content is loading. In `extension/options.js`,
  when switching tabs (the `data-tab` click handler), show the spinner for
  that tab's panel before beginning data load, then hide it when the async
  render function resolves. This is most noticeable for the Cache and Rules
  tabs which do async reads. Use the existing `.spinner` CSS class.

- [ ] **T12.15: Add brief visual feedback when auto-classification succeeds**
  In `extension/background.js`, after a successful classification in
  `handleTab()` (rule, cache, or LLM), send a fire-and-forget message to:
  - Update the browserAction badge briefly: set badge text to "✓" with
    green background for 2 seconds, then restore normal badge via
    `updateBadge()`. Use a debounce so rapid classifications don't
    flicker the badge.
  - If the popup is open, the popup state refresh will pick up the change.
  
  This gives users a subtle "something happened" signal without intrusive
  notifications.

- [ ] **T12.16: Add tooltips to group tags in popup**
  In `extension/popup.js`, when rendering group tags (~line 139–145), add
  `title` attributes showing: group name, tab count, hibernation opt-out
  status (e.g., "Code — 12 tabs, hibernation: on" or
  "Email — 3 tabs, hibernation: off"). Also show the group color name.
  This makes the non-interactive tags useful for at-a-glance scanning.

### Constants & Cleanup

- [ ] **T12.17: Extract hardcoded rule suggestion timeout to constant**
  In `extension/background.js`, the 30-second rule suggestion auto-dismiss
  timeout is hardcoded as `30000` in two places: `_showRuleSuggestion()`
  (line 1735) and `loadPendingSuggestions()` (line 1763). Extract to
  `RULE_SUGGESTION_TIMEOUT_MS` in `extension/lib/constants.js` (alongside
  existing `DEBOUNCE_MS`, `SEARCH_DEBOUNCE_MS`). Update both call sites to
  use the constant. This makes tuning trivial and prevents the two values
  from drifting apart.

### Tests

- [ ] **T12.18: Update tests for Phase 12 changes**
  Run `nix-shell -p nodejs_22` then `npm test`. Update
  `tests/background.test.js` to cover:
  - Content extraction pipeline (mock `browser.tabs.sendMessage` returning
    `{ title, h1, text }`, verify enriched prompt)
  - `isEnabled` passed as parameter to `_classifyTabPreLLM` (verify it's
    not called redundantly per-tab)
  - Promote-to-rule via `TabTamerRules.addRule`
  - Content classification toggle (disabled → URL-only fallback)
  Update `tests/setup.js` mock for any new `browser.*` API calls (e.g.,
  `browser.tabs.sendMessage` for content extraction).

  Ensure all existing tests still pass.

### Documentation

- [ ] **T12.19: Update DESIGN.md resolved questions**
  Remove "Content-based classification" from open questions — mark as
  implemented. Add configuration note about `contentClassificationEnabled`.
  Keep "Group splitting", "Manifest v3 migration", and "Cross-browser
  support" as open/deferred.

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.
