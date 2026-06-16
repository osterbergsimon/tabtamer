# TabTamer — Phase 6

## Overview

Phase 6 fixes correctness bugs, UX rough edges, and performance issues
discovered during a second-pass codebase audit. While Phase 5 addressed
the most visible gaps, deeper issues remain: acronym-breaking normalization,
missing hash-based SPA support, notification spam on updates, race conditions
in cache editing, and wasted resources from stale debounce timers. Also adds
privacy controls and prepares for Manifest v3 migration.

Key themes:
- **Correctness**: Preserve acronyms in group names (API, NixOS, URL);
  monitor `hashchange` for hash-based SPAs; fix cache edit race condition.
- **UX**: Stop showing onboarding notification on extension updates when
  API key is already configured.
- **Performance**: Debounce `updateBadge()` calls; clean up debounce
  timers when tabs close; use accurate per-call token estimates.
- **Privacy**: Add optional domain exclusion list so users can keep
  sensitive domains (banking, internal tools) from being sent to the LLM.
- **Code quality**: Rename `_notifiedNoApiKey` to `tabtamerNotifiedNoApiKey`
  for naming consistency.
- **Documentation**: Update TESTING.md to remove stale Phase 2 references
  and match current log output.

## Files to modify

```
extension/
├── manifest.json          # bump version to 1.6.0
├── background.js           # acronym-aware normalization, hashchange listener,
│                             debounce updateBadge, tab-close cleanup for timers,
│                             onInstalled guard, rename storage key,
│                             per-call token estimates, domain exclusion filter
├── content.js              # add hashchange event listener
├── options.html            # domain exclusion list UI
├── options.js              # domain exclusion list logic
└── TESTING.md              # remove stale Phase 2 references, update log examples
```

## Tasks

- [ ] **T6.1: Preserve known acronyms in `normalizeGroupName`**
  In `background.js` `normalizeGroupName()`: before title-casing, protect
  known all-caps acronyms (e.g., API, URL, DNS, SSH, CPU, GPU, HTML, CSS,
  JS, JSON, XML, YAML, CSV, PDF, SQL, HTTP, HTTPS, SSL, TLS, VPN, CI, CD,
  PR, AI, ML, LLM, UI, UX, CLI, SDK, IDE, AWS, GCP, NixOS). After
  title-casing each word, if the uppercase version of the word matches a
  known acronym, use the uppercase form instead. This fixes "Api" → "API",
  "Nixos" → "NixOS", "Url" → "URL", etc.

- [ ] **T6.2: Monitor `hashchange` events in content script**
  In `content.js`: add a `window.addEventListener('hashchange', ...)`
  listener that sends a `spaNavigate` message with the new `location.href`.
  This catches hash-based SPA routers (e.g., `example.com/#/page`) that
  don't use the History API. Debounce is handled by the background script's
  existing per-tab timer.

- [ ] **T6.3: Guard `onInstalled` notification — skip if API key exists**
  In `background.js` `onInstalled` handler: before opening the options page
  and showing the "Set up TabTamer" notification, check whether the user
  already has an API key configured. If `settings.apiKey` is set, skip both
  the options-page open and the notification. The notification is only
  useful for brand-new installs where the user has never configured a key.

- [ ] **T6.4: Fix cache dashboard race condition with atomic read-modify-write**
  In `options.js` cache dashboard save handler: the current GET→modify→SET
  pattern can lose concurrent writes from the background script. Instead,
  use `browser.storage.local.get()` then immediately `set()` with the
  specific key (rather than the full cache) to minimize the window, or
  use a compare-and-swap pattern with a version counter. Minimum fix:
  re-read the cache just before writing and merge the edit into the
  freshest data, logging a warning if a conflict is detected.

- [ ] **T6.5: Clean up debounce timers when tabs are closed**
  In `background.js`: add a `browser.tabs.onRemoved` listener that checks
  `_debounceTimers` for the removed tabId and calls `clearTimeout()` to
  cancel the pending timer. Without this, closing a tab during the 500ms
  debounce window still fires `handleTab()`, which wastes a concurrency
  slot on a dead tab before hitting the "Invalid tab ID" catch.

- [ ] **T6.6: Debounce `updateBadge()` calls**
  In `background.js`: wrap `updateBadge()` so that rapid successive calls
  (e.g., multiple tabs classified in quick succession during startup scan
  or periodic cleanup) are coalesced. Use a short trailing debounce
  (~500ms). Each call currently does `browser.tabGroups.query({})`, which
  is wasted when triggered dozens of times in a burst.

- [ ] **T6.7: Rename `_notifiedNoApiKey` to `tabtamerNotifiedNoApiKey`**
  In `background.js`: rename the storage key `_notifiedNoApiKey` to
  `tabtamerNotifiedNoApiKey` for consistency with the other storage keys
  (`tabtamerSettings`, `domainGroupCache`, `tabtamerCosts`,
  `tabtamerManagedGroups`). Also rename in `options.js` where it's cleared
  on settings save. This is a pure rename — no behavioral change.

- [ ] **T6.8: Use per-call-type token estimates for accurate cost tracking**
  In `background.js`: replace the flat `ESTIMATED_TOKENS_PER_CALL = 200`
  with separate estimates: `TOKENS_CLASSIFY = 150` (short prompt + 5-word
  response) and `TOKENS_MERGE = 500` (longer prompt with group list + JSON
  response). Pass the appropriate estimate to `updateCosts()` from
  `classifyAndAssign()` and `mergeSimilarGroups()`. This makes the cost
  display in the options page more accurate.

- [ ] **T6.9: Add domain exclusion list for privacy**
  Add a new storage key `tabtamerExcludedDomains` (array of domain strings).
  In `background.js` `handleTab()`: after extracting the domain, check
  whether it matches any entry in the exclusion list (exact match or
  wildcard `*.domain`). If excluded, skip classification and leave the tab
  ungrouped. In `options.html`: add a new card "Excluded Domains" with a
  textarea (one domain per line) and a Save button. In `options.js`:
  load/save the exclusion list from storage. This lets users keep banking,
  internal corporate, or localhost domains private.

- [ ] **T6.10: Update TESTING.md — remove stale Phase 2 references**
  In `TESTING.md`: update test descriptions that reference "Phase 2"
  (Tests 7-11, 15). Either remove the parenthetical tags or update them
  to reflect the current state. Verify log message examples match the
  current code output. Update the automated verification table if needed.

- [ ] **T6.11: Bump manifest version to 1.6.0**
  Update `manifest.json` `version` from `"1.5.0"` to `"1.6.0"`.

- [ ] **Meta: Do nothing — spec loop is handled by loop.sh**
  This is a deliberate no-op. The outer shell loop (./loop.sh) handles
  the build → spec-write → build cycle. Do NOT run iteratr or the
  spec-writer from here. Simply mark this task as done without taking
  any action.

## Design notes

### Acronym preservation (T6.1)
The known-acronym set should be maintained as a constant list near the
top of `background.js`. The algorithm: split on whitespace, for each
word, compute its uppercase form. If the uppercase form is in the
acronym set AND the original word contains at least one uppercase
letter (to avoid over-normalizing), use the uppercase form. Otherwise
apply standard title-case (first letter uppercase, rest lowercase).

### Domain exclusion list (T6.9)
Storage format: `{ "tabtamerExcludedDomains": ["example.com", "*.internal.corp"] }`.
Matching: exact domain match or suffix match for `*.` wildcards
(e.g., `*.google.com` matches `mail.google.com` and `drive.google.com`).
The check happens early in `handleTab()`, before cache lookup, so
excluded domains never hit the cache and never trigger API calls.

### hashchange handling (T6.2)
The `hashchange` event fires on `window` when the URL fragment changes.
It does NOT fire for `pushState`/`replaceState` navigations, so it's
complementary to the existing History API patches. The background script's
existing per-tab debounce timer will coalesce rapid hash changes.

### Cache edit race (T6.4)
The minimum fix uses a re-read-before-write pattern:
1. Read current cache
2. Apply edit to the in-memory copy
3. Re-read cache from storage
4. If the target key changed since step 1, warn and merge
5. Write the merged result

This is not fully atomic but dramatically reduces the race window for
the common case (user editing while no background classification is
in flight).

### Per-call token estimates (T6.8)
- Classification prompt: ~80 system + ~40 user = ~120 tokens in, ~5 out → ~150 with overhead
- Merge prompt: ~80 system + ~10/group user + ~5/group response ≈ 200-800 depending on group count
  Using a conservative 500 covers most sessions (≤10 groups).
