# TabTamer — Phase 10

## Overview

Phase 10 delivers the three most-requested missing features from DESIGN.md:
**multi-provider support** (OpenRouter, Ollama, Together AI presets), **live cost
tracking** (actual token usage from API responses, user-configurable pricing),
and **LLM-assisted rule creation** (proactively suggest rules after classification).
Alongside these, we fix 4 critical bugs, close 6 UX gaps, and add 4 accessibility
improvements.

The theme: **trust and flexibility**. Users gain control over their AI provider
and costs, the LLM becomes a collaborative assistant that teaches the extension
permanent rules, and sharp edges are smoothed for daily use.

## Files to modify

```
extension/
├── manifest.json          (bump 1.9.0 → 1.10.0, CSP for multi-provider)
├── background.js          (multi-provider, live tokens, rule suggestion toasts,
│                            Retry-After:0 fix, _lastAccessTimes persist on unload,
│                            content port reconnect, badge emoji, startup progress)
├── lib/constants.js       (remove hardcoded API_ENDPOINT, COST_PER_TOKEN,
│                            TOKENS_CLASSIFY, TOKENS_MERGE; add provider presets)
├── lib/utils.js           (fix normalizeGroupName for camelCase proper nouns;
│                            add isWellKnownProperNoun helper)
├── options.html           (provider preset selector, $/M-token input, fetch-pricing
│                            button, bulk rule actions, toast duration slider,
│                            last-classified timestamps in cache dashboard)
├── options.js             (multi-provider settings, live cost display, fetch
│                            pricing, bulk rule ops, tab persistence on reload,
│                            undo for cache edits, ARIA labels on color pickers)
├── popup.html             (search/filter in group list, tab title on classify
│                            button, tooltips on group tags, aria-label on toggle)
├── popup.js               (filter groups, show active tab info, delayed close
│                            after classify)
├── search.html            (aria role="listbox" on results)
├── search.js              (Ctrl+W to close, aria-activedescendant)
├── content.js             (auto-reconnect port on disconnect)
└── icons/
    └── icon-48-dark.png   (new dark-theme toolbar icon variant)
```

## Tasks

### T10.0: Read AGENTS.md

- [ ] **T10.0: Read AGENTS.md**
  Read `AGENTS.md` for project conventions, gotchas, and architecture
  notes. Also read `DESIGN.md` for component architecture.

### Bugs (blockers first)

- [ ] **T10.1: Fix `retryWithBackoff` mishandling `Retry-After: 0`**
  In `background.js`, the `retryWithBackoff` function parses the
  `Retry-After` header with `parseInt(header, 10)`. When the header is
  `"0"` (meaning "retry immediately"), `parseInt('0', 10)` returns `0`
  which is falsy, causing the code to fall through to the default delay.
  Fix: explicitly check for `!== null` / `!isNaN()` instead of truthiness.

- [ ] **T10.2: Fix `normalizeGroupName` destroying camelCase proper nouns**
  In `lib/utils.js`, `normalizeGroupName()` lowercases everything after
  the first letter, turning "GitHub" → "Github", "YouTube" → "Youtube",
  "GitLab" → "Gitlab". Add a `KNOWN_CAMELCASE` set alongside the existing
  `KNOWN_ACRONYMS` set, checked before applying the generic title-case
  transformation. Include at minimum: GitHub, YouTube, GitLab, Reddit,
  LinkedIn, eBay, Upwork, WhatsApp, PayPal, TikTok, WordPress, Medium,
  Substack, UberEats, DoorDash.

- [ ] **T10.3: Fix content script port disconnect — add auto-reconnect**
  In `content.js`, when the background script restarts, the `browser.runtime`
  port disconnects (`onDisconnect` fires) and the content script removes
  its SPA navigation patches but never reconnects. SPA detection stops
  until the user manually reloads the page. Add a reconnect loop:
  on disconnect, wait 2s, then call `browser.runtime.connect()` again
  and re-attach the history monkey-patches.

- [ ] **T10.4: Persist `_lastAccessTimes` on `beforeunload`**
  In `background.js`, `_lastAccessTimes` is throttled to persist to storage
  every 30 seconds. If the browser closes before the timer fires, access
  times since the last persist are lost, causing incorrect hibernation
  decisions. Add a `runtime.onSuspend` listener (for clean shutdown) and a
  `beforeunload`-equivalent to flush immediately. Also reduce the persist
  interval from 30s to 15s as a belt-and-suspenders measure.

### Big Features

- [ ] **T10.5: Multi-provider support — configurable API endpoint + model + key**
  Replace the hardcoded `API_ENDPOINT` in `lib/constants.js` with a
  user-configurable setting (`customEndpoint` in `browser.storage.local`).
  Ship with one-click provider presets:
  - **OpenRouter**: `https://openrouter.ai/api/v1/chat/completions`
  - **Ollama** (local): `http://localhost:11434/v1/chat/completions`
  - **Together AI**: `https://api.together.xyz/v1/chat/completions`
  - **Custom**: free-text URL input
  Add a provider selector (dropdown + custom field) to `options.html`
  and `options.js`. When a preset is selected, auto-fill the endpoint
  and suggest a default model. Update `background.js` to read endpoint
  from settings at call time (not import time). Update `manifest.json`
  CSP `connect-src` to support dynamic endpoints (use `*` wildcard or
  add `https://openrouter.ai/*`, `http://localhost:11434/*`,
  `https://api.together.xyz/*`). Update permissions similarly.

- [ ] **T10.6: Live cost tracking — actual token usage from API responses**
  In `background.js`, after each successful LLM API call, extract
  `usage.total_tokens` (or `usage.prompt_tokens + completion_tokens`)
  from the response JSON. Store the real token count in the `costs`
  storage alongside the old estimates. Update the cost display in
  `options.js` and `popup.js` to show both estimated and live totals.
  Remove the hardcoded `TOKENS_CLASSIFY=150` and `TOKENS_MERGE=500`
  constants from `lib/constants.js`; compute estimates dynamically
  from prompt length instead.

- [ ] **T10.7: User-configurable pricing — $/M-token rate with "Fetch pricing"**
  Replace the hardcoded `COST_PER_TOKEN=0.000001` ($1/M) in
  `lib/constants.js` with a user setting `costPerMillionTokens` (default
  `1.0` for $1/M). Add a number input to `options.html` labeled "$/M tokens".
  Add a "Fetch pricing" button that queries the selected provider's pricing
  endpoint (if available) and auto-fills the rate. In `options.js`, label
  costs as "estimated" if based on estimate tokens + user rate, or "live"
  if based on actual tokens + user rate. Update `background.js` cost
  calculations to use the user's rate.

- [ ] **T10.8: LLM-assisted rule creation — per-classification prompt**
  After the LLM successfully classifies a domain (cache miss → API call),
  show a non-blocking toast or notification: *"Save `github.com → Code`
  as a rule?"* with Approve/Dismiss actions. Approving adds a rule via
  the rules engine. Dismissing does nothing. Track dismissed suggestions
  in storage to avoid re-prompting for the same domain within 30 days.
  Implement in `background.js` using `browser.notifications.create()` with
  buttons, and a `browser.notifications.onButtonClicked` listener to
  handle the Approve action.

- [ ] **T10.9: LLM-assisted rule creation — batch cache scanning**
  Add a "Suggest Rules" button to the options page cache dashboard.
  When clicked, sample up to 50 cache entries, build a prompt listing
  domain→group mappings, and ask the LLM: *"Identify patterns in these
  domain→group mappings and suggest rules. Each rule should be a glob
  pattern + group name. Return a JSON array of {pattern, groupName,
  confidence} objects."* Display results in a modal with checkboxes for
  the user to approve/reject each suggestion. Approved suggestions become
  enabled rules. Implement in `options.html` + `options.js` +
  `background.js` (the API call goes through background for consistent
  auth handling).

- [ ] **T10.10: Per-tab temporary override — "Move to group X just this once"**
  Add a context menu item "Move to group…" with a submenu of existing
  TabTamer-managed group names. When selected, move the tab to that group
  without updating the cache or creating a rule — it's a one-time override.
  Implement in `background.js` via `browser.contextMenus.create()` and
  `browser.contextMenus.onClicked`. Dynamically rebuild the submenu when
  groups change.

### UX & Polish

- [ ] **T10.11: Add undo for cache entry edit/delete**
  In `options.js`, when a cache entry is edited or deleted, store the
  previous value in a temporary undo stack. Show a toast: "Cache entry
  deleted — Undo" with a clickable Undo action. The undo restores the
  entry. Stack depth: 10. Auto-clear after 10 seconds.

- [ ] **T10.12: Show progress during startup scan**
  In `background.js`, during `startupScan()`, send periodic progress
  messages to the popup and update the badge with "N/M" (e.g., "3/42")
  instead of just "…". The popup should show a progress bar or count
  when scans are in progress. Add a `runtime.sendMessage` call after
  each classified tab during startup scan, and handle the message in
  `popup.js`.

- [ ] **T10.13: Add search/filter to popup group list**
  In `popup.html`, add a small search input above the group list.
  In `popup.js`, filter the rendered groups by substring match on
  group name as the user types. Debounce at 150ms.

- [ ] **T10.14: Show active tab info on "Classify Tab" button and delay close**
  In `popup.html`, update the button text to "Classify `tabtitle.com`"
  (truncated to 30 chars). In `popup.js`, after clicking classify, show
  a brief "Classifying…" state on the button for 500ms before closing
  the popup, so the user sees confirmation.

- [ ] **T10.15: Add "last classified" timestamp to cache dashboard**
  In `background.js`, when caching a domain→group mapping, store a
  `timestamp` alongside the group name (or in a parallel
  `cacheTimestamps` object). In `options.js`, display "Classified 3
  days ago" or "Classified 2026-01-15" in each cache dashboard row.

- [ ] **T10.16: Persist options page tab selection on reload**
  In `options.js`, save the active tab name to `sessionStorage` (not
  extension storage — only for the current page session). On page load,
  restore the last active tab. This survives F5 but not full page close.

- [ ] **T10.17: Add dark theme toolbar icon variant**
  Create a 48×48 dark-theme icon `icons/icon-48-dark.png` (light-on-dark
  version of the existing icon). Reference it in `manifest.json` via
  `browser_action.default_icon` with the `"dark"` theme key, or use
  `browser.browserAction.setIcon()` in `background.js` based on the
  user's dark mode setting.

- [ ] **T10.18: Add bulk actions to rules table**
  In `options.html`, add "Select All" / "Deselect All" checkboxes and
  "Delete Selected" / "Disable Selected" / "Enable Selected" buttons
  above the rules table. In `options.js`, implement multi-select logic
  and batch operations.

- [ ] **T10.19: Add tooltips to truncated popup group tags**
  In `popup.html`, add `title` attributes to group name elements showing
  the full group name. CSS truncation hides overflow but the native
  tooltip on hover reveals the full text.

- [ ] **T10.20: Add Ctrl+W to close Smart Tab Search**
  In `search.js`, add a keydown listener: if Ctrl+W (or Cmd+W on Mac)
  is pressed, close the search tab via `window.close()`. This matches
  user expectation that Ctrl+W closes any tab.

- [ ] **T10.21: Fix cache dashboard Domain column word-breaking**
  In `options.js`, change the CSS for the Domain column from
  `word-break: break-all` to `overflow-wrap: break-word` so domain
  names break at natural boundaries (dots, hyphens) rather than
  mid-character.

### Accessibility

- [ ] **T10.22: Add ARIA labels to cache dashboard color pickers**
  In `options.js`, add `aria-label="Color for domain.com"` to each
  `<select>` element rendered in the cache dashboard table.

- [ ] **T10.23: Add aria-label to popup toggle switch**
  In `popup.html`, add `aria-label="Toggle TabTamer auto-grouping"`
  to the pause toggle switch element.

- [ ] **T10.24: Add ARIA listbox role to Smart Tab Search results**
  In `search.html`, add `role="listbox"` to the results container `<div>`
  and `role="option"` + `aria-selected` to each result item. In
  `search.js`, manage `aria-activedescendant` on the listbox as the
  selection changes.

- [ ] **T10.25: Add keyboard toggle visual confirmation**
  In `background.js`, when `Ctrl+Shift+G` toggles TabTamer, fire a
  brief `browser.notifications.create()` toast: "TabTamer: ON" or
  "TabTamer: OFF" with the current state. Use a short-lived
  notification (auto-dismiss in 2s).

### Documentation

- [ ] **T10.26: Bump manifest version**
  Update `manifest.json` version from `1.9.0` to `1.10.0`.

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. Do NOT run iteratr or the spec-writer from here.
  Simply mark this task as done without taking any action.

## Design notes

### Multi-provider storage schema

```json
{
  "settings": {
    "providerPreset": "openrouter",
    "customEndpoint": "https://openrouter.ai/api/v1/chat/completions",
    "apiKey": "sk-...",
    "model": "openai/gpt-4o-mini",
    "costPerMillionTokens": 0.15,
    "costPerMillionTokensInput": null,
    "costPerMillionTokensOutput": null
  }
}
```

Provider presets (stored in constants, not user storage):

| Preset | Endpoint | Default Model | ~$/M tokens |
|--------|----------|---------------|-------------|
| `opencode` | `https://opencode.ai/zen/go/v1/chat/completions` | `deepseek-v4-flash` | $1.00 |
| `openrouter` | `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o-mini` | $0.15 |
| `together` | `https://api.together.xyz/v1/chat/completions` | `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8` | $0.20 |
| `ollama` | `http://localhost:11434/v1/chat/completions` | `llama3.2` | $0.00 (local) |
| `custom` | (user-provided) | (user-provided) | (user-provided) |

### CSP and permissions for multi-provider

Manifest v2 requires explicit `connect-src` entries. We must add:
- `https://openrouter.ai/*`
- `https://api.together.xyz/*`
- `http://localhost:11434/*` (Ollama local)

And matching host permissions for Firefox.

### normalizeGroupName fix approach

Rather than a complex linguistic model, add a `KNOWN_CAMELCASE` set of
well-known proper nouns that use camelCase. This is a pragmatic 80/20
solution — covers the most common cases without false positives. The set
can be expanded over time.

### Rule suggestion persistence

Track dismissed suggestions in storage:
```json
{
  "dismissedRuleSuggestions": {
    "github.com": 1718640000000
  }
}
```
Entries older than 30 days are pruned. The Approve action creates a rule
via `rules-engine.js` and removes any dismissal.

### Undo stack for cache edits

Store in module-scoped variable (not persistent — cleared on extension reload):
```js
let _cacheUndoStack = []; // max 10 entries
```
Each entry: `{action: 'delete'|'edit', domain, groupName, previousGroupName?}`.
Toast shows for 10s then auto-expires.
