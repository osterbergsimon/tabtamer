# TabTamer — LLM-powered tab grouping for Firefox

## Overview

**TabTamer uses a cheap LLM to automatically categorize open tabs into Firefox
native tab groups.** Each new tab is sent to the LLM (opencode-go) for
classification into a short group name (e.g. "NixOS", "GitHub", "Email") —
this is the core intelligence that makes TabTamer different from pattern-based
tab groupers. A rules engine and domain→group cache skip the LLM for known
sites, so you only pay for first visits. A toolbar popup gives at-a-glance
visibility, and idle tabs in managed groups are automatically hibernated to
free memory.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Firefox                       │
│  ┌──────────┐    ┌──────────────┐               │
│  │ New tab  │──►│  TabTamer     │               │
│  │ created  │   │  extension    │               │
│  └──────────┘   │               │               │
│                 │ 1. Check      │               │
│                 │    rules      │               │
│                 │              │               │
│                 │ 2. Check      │               │
│                 │    cache      │               │
│                 │              │               │
│                 │ 3. Cache miss?               │
│                 │    fetch() ───┼───────────┐   │
│                 │               │           │   │
│                 │ 4. Create/use │  ┌────────▼──┐
│                 │    tab group  │  │ opencode   │
│                 │               │  │ API        │
│                 │ 5. Move tab   │  │ (Zen Go)   │
│                 │    into group │  │            │
│                 │               │  │ /chat/     │
│                 │ 6. Update     │  │ completions│
│                 │    cache      │  └────────────┘
│                 │               │               │
│                 │ 7. Track for  │               │
│                 │    hibernation│               │
│                 └──────────────┘               │
└─────────────────────────────────────────────────┘
```

No daemon, no native messaging, no CLI — entirely self-contained in the browser.

## Components

### 1. Firefox Extension (`tabtamer/`)

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (v2) with permissions |
| `background.js` | Background script: tab detection, rules engine, LLM calls, group management, hibernation |
| `options.html` | Settings page: API key, model, rules editor, cache dashboard, hibernation controls, import/export |
| `options.js` | Settings page logic |
| `popup.html` | Toolbar popup: pause toggle, group stats, recent classifications, classify button |
| `popup.js` | Popup logic |
| `search.html` | Smart Tab Search / Quick Switcher (Ctrl+Shift+K) |
| `search.js` | Fuzzy-search logic for tab switching |
| `content.js` | Content script: detects SPA navigation (pushState, popstate, hashchange) |
| `lib/constants.js` | Shared storage keys, API URL, magic numbers, alarm names |
| `lib/utils.js` | Shared utilities: `extractDomain`, `sleep`, `normalizeGroupName` |
| `lib/rules-engine.js` | User-customizable domain→group rules with glob patterns and priority ordering |

Permissions needed:
- `tabs` — detect new tabs, query tab state, discard tabs for hibernation
- `tabGroups` — create / manage / color Firefox native tab groups
- `storage` — cache domain→group mappings, rules, colors, settings, cost tracking, hibernation state
- `alarms` — periodic cleanup, merge, and hibernation alarms
- `notifications` — API key reminder notifications
- `contextMenus` — right-click "Classify This Tab" re-classification
- `windows` — enumerate windows for cache rename and hibernation operations
- `https://opencode.ai/*` — call the LLM API (also needed for custom endpoints via connect-src CSP)

### 2. LLM API

| Field | Value |
|-------|-------|
| **Endpoint** | `https://opencode.ai/zen/go/v1/chat/completions` |
| **Model** | `deepseek-v4-flash` (cheap, fast) |
| **Auth** | `Authorization: Bearer <api-key>` |
| **Cost/tab** | ~200 tokens × ~$0.10/M ≈ $0.00002 (first visit only) |

**Multi-provider support (future):** The API is OpenAI-compatible. Allowing the
user to enter any endpoint URL (OpenRouter, Together, local llama.cpp, Ollama)
would require zero protocol changes — just a configurable base URL + model
field. The extension could ship with presets for common providers.

**Token counting — use actual API usage, not hardcoded estimates:**
The `TOKENS_CLASSIFY` and `TOKENS_MERGE` constants are hardcoded guesses. The
API response includes `usage.prompt_tokens` + `usage.completion_tokens` (or
`usage.total_tokens`) — real token counts. Cost tracking should use those
instead of estimates. Fall back to estimates only if the API omits usage.

**Cost tracking — user-configurable, not hardcoded:**
`COST_PER_TOKEN` is hardcoded at `$0.000001` ($1/M tokens). This should be a
user setting (cost per million tokens) with a sensible default. The options
page should:
- Let the user enter their provider's $/M-token rate
- Show a "Fetch pricing" button that hits the provider's pricing endpoint
- Label costs as "estimated" vs "live" based on whether real usage data and
  user-configured rates were used

### 3. Rules Engine

**Optimization layer on top of LLM classification.** The LLM is the core
intelligence; rules let you lock in its decisions permanently. Execution order:

1. **Rules** (instant, free) — first enabled rule matching domain wins
2. **Cache** (instant, free) — previously classified domains
3. **LLM** (API call, ~$0.00002) — classifies unknown domains, populates cache

Over time, cached domains can be promoted to rules — progressively migrating
from pay-per-call to free rule-based matching.

**LLM-assisted rule creation (future):** When the LLM classifies a domain,
prompt the user *"Save `github.com → Code` as a rule?"* The LLM could also
suggest rules proactively — e.g. batch-scanning the cache for patterns and
proposing rules with confidence scores.

**User override:** Users must always be able to bypass or disable rules:
- **Global disable** — toggle rules engine off entirely; all tabs go straight
  to cache → LLM, ignoring rules. For users who prefer pure LLM classification.
- **Right-click → "Classify This Tab"** — forces LLM re-classification even
  when a rule matches
- **Manual rule management** — add, edit, disable, delete, or reorder rules
  on the options page (full CRUD with inline validation)
- **Per-tab override** — temporarily classify a tab to a different group
  without changing the rule

**Rule format** (stored in `browser.storage.local`):

```json
{
  "tabtamerRules": [
    { "pattern": "github.com", "groupName": "Code", "enabled": true },
    { "pattern": "*.nixos.org", "groupName": "NixOS", "enabled": true },
    { "pattern": "mail.google.com", "groupName": "Email", "enabled": false }
  ]
}
```

**Matching**: Glob patterns (`*` wildcard, `?` single char) are converted to
anchored regex. The first enabled rule whose pattern matches the full domain
wins. Rules run in priority order (drag-to-reorder in the options page).

**Management**: Full CRUD via options page — add/edit/delete/disable/reorder
rules with inline validation. Import/export rules as JSON.

### 4. Caching

Stored in `browser.storage.local`:

```json
{
  "cache": {
    "github.com": "GitHub",
    "nixos.org": "NixOS",
    "mail.google.com": "Email"
  },
  "settings": {
    "apiKey": "sk-...",
    "model": "deepseek-v4-flash",
    "customEndpoint": "",
    "enabled": true,
    "hibernateAfterMinutes": 30,
    "toastDurationMs": 3000
  },
  "tabtamerRules": [
    { "pattern": "*.github.com", "groupName": "Code", "enabled": true }
  ],
  "tabtamerGroupColors": {
    "GitHub": "blue",
    "Email": "purple"
  },
  "costs": {
    "totalCalls": 142,
    "estimatedTokens": 28400,
    "totalCost": 0.00284
  },
  "hibernateOptOut": ["Email"],
  "recentClassifications": [
    { "domain": "github.com", "groupName": "Code", "source": "rule", "timestamp": 1718640000000 }
  ]
}
```

Cache, rules, and colors are importable/exportable as JSON from the options page.
Cache is cleared when the extension updates or manually.

### 5. Smart Tab Search (Quick Switcher)

A command-palette-style tab switcher (`search.html` + `search.js`) activated via
`Ctrl+Shift+K` (configurable in `manifest.json` commands).

**Features:**
- Lists all open tabs across all windows with title, URL, and group name
- Fuzzy substring filtering as the user types (no library needed — small search space)
- Enter key switches to the selected tab and closes the search UI
- Theme-aware styling matching the options page (light/dark from settings)
- Opens as a dedicated tab when the keyboard shortcut is triggered

**Architecture:**
- `background.js` listens for the `tabtamer-search` command and opens `search.html`
- `search.js` queries `browser.tabs.query({})` and `browser.tabGroups.query({})` to build the tab list
- The search UI selects the tab via `browser.tabs.update()` and closes itself

### 6. Group Color Customization

Users can override the deterministic djb2 hash color for any TabTamer-managed group
via the options page cache dashboard.

**Storage:**
- Key: `tabtamerGroupColors` (flat object, e.g. `{"GitHub": "blue", "Email": "purple"}`)
- Colors: one of the 9 Firefox-supported tab group colors (grey, blue, red, yellow,
  purple, pink, green, orange, cyan)

**Behavior:**
- `getGroupColor()` in `background.js` checks custom colors first, falls back to djb2 hash
- Custom colors persist across sessions and survive group renames (migrated to new name)
- The options page cache dashboard shows a color dropdown picker next to each cache entry

### 7. Toolbar Popup

A lightweight popup (`popup.html` + `popup.js`) accessible via the toolbar icon,
providing at-a-glance visibility and quick actions without opening the full
options page.

**Features:**
- **Pause toggle** — turn auto-grouping on/off instantly
- **Group stats** — count of managed groups with color swatches and names
- **Recent classifications** — last 10 tabs classified (domain → group, with timestamp)
- **Classify This Tab** — classify the current active tab on demand
- **Processing indicator** — shows "Classifying…" spinner during active LLM calls
- **Error state** — graceful "Could not load" with retry button
- **Dark mode** — theme-aware styling matching the options page
- **Refresh button** — reload popup state manually

**Architecture:**
- Popup requests state from background via `browser.runtime.sendMessage`
- Background responds with enabled status, group list, recent classifications,
  processing state, and hibernation count
- Buttons (toggle, classify, refresh) send messages back to background

### 8. Tab Hibernation

Automatically discards idle tabs in TabTamer-managed groups to free memory.
Runs on a periodic alarm (default: every 10 minutes).

**Behavior:**
- Only hibernates tabs in groups created by TabTamer
- Tab must be idle longer than configurable threshold (default: 30 minutes)
- Already discarded tabs are skipped
- Per-group opt-out via options page (checkboxes in cache dashboard)
- Badge shows 💤 count of hibernated tabs
- Tab access times tracked on navigation and activation events

**Settings:**
| Setting | Default | Description |
|---------|---------|-------------|
| `hibernateAfterMinutes` | 30 | Idle time before discard (or "never" to disable) |
| `hibernateOptOut` | `[]` | Group names excluded from hibernation |

### 9. Import / Export

Both the domain→group cache and the rules engine support JSON import/export
via the options page.

**Cache:**
- Export downloads `tabtamer-cache.json` with the full cache object
- Import merges entries into the existing cache (duplicates are overwritten)
- Imported entries skip the LLM immediately (they're pre-cached)
- File picker with validation; errors shown via toast

**Rules:**
- Export downloads `tabtamer-rules.json` with the full rules array
- Import replaces the entire rules array (not a merge)
- Validation: each entry must have `pattern` and `groupName` properties

### 10. Content Script (SPA Navigation)

`content.js` runs on every page (`document_start`) to detect single-page app
navigation events that wouldn't fire `tabs.onUpdated`:

- `pushState` / `replaceState` — monkey-patched to fire `spaNavigate`
- `popstate` — back/forward navigation
- `hashchange` — fragment-only navigation

Messages are sent to background.js, which applies debounce (1.5s per tab) to
avoid re-classifying during rapid redirects (e.g. OAuth flows).

## Flow

### New tab classification

```
1. tabs.onUpdated fires (or spaNavigate message from content script)
2. Parse URL → extract domain
3. Check rules engine: first enabled rule matching domain wins
   ├─ Match → use rule's group name (skip LLM entirely)
   └─ No match → continue
4. Check storage.local cache for domain
   ├─ Hit  → use cached group name
   └─ Miss → call LLM API
5. Look up or create native tab group with that name
6. tabs.group({ tabId, groupId })
7. Save domain→group in cache (unless matched by rule with "don't cache")
```

### LLM prompt

```
System: You are a tab organizer. Given a URL and page title,
return a short group name (1-3 words, Title Case).
Examples: "GitHub", "Email", "NixOS", "Documentation",
"YouTube", "Shopping", "Social", "Work".
Return ONLY the group name, no explanation or punctuation.

User:
URL: https://github.com/NixOS/nixpkgs/pull/123
Title: feat: add new module by user · Pull Request #123 · NixOS/nixpkgs

Assistant:
NixOS
```

### Error handling

- API unreachable → leave tab ungrouped, retry on next new tab
- API returns invalid response → leave tab ungrouped, don't cache
- Rate limited → exponential backoff, don't cache
- User disables extension → stop processing, keep existing groups

## Settings (options page)

| Setting | Default | Description |
|---------|---------|-------------|
| API Key | (empty) | `sk-...` from opencode.ai |
| Model | `deepseek-v4-flash` | cheaper = flash, smarter = pro |
| Custom Endpoint | (empty) | Override API base URL (e.g. self-hosted) |
| Enabled | on | Pause auto-grouping temporarily |
| Hibernate After | 30 min | Idle time before discarding tabs (or "never") |
| Toast Duration | 3s | How long toast notifications stay visible |
| Clear cache | — | Reset all domain→group mappings |

**Rules engine** settings are managed inline on the options page (add/edit/delete
rules with pattern + group name). **Custom group colors** are set per row in the
cache dashboard dropdown.

## Integration with dotfiles

Packaged as a local Firefox extension in home-manager:

```nix
# users/tux/programs/tabtamer.nix
{ pkgs, ... }:
{
  programs.firefox.profiles.tux.extensions = {
    packages = [
      (pkgs.fetchFirefoxAddon {
        name = "tabtamer";
        src = ../path/to/built/extension.xpi;
        ...
      })
    ];
  };
}
```

Or loaded temporarily via `about:debugging` for development.

## Resolved questions

Previously open questions addressed across Phases 2–9:

1. **Group merging** — `mergeSimilarGroups()` runs on a periodic alarm, re-classifying existing tab groups to merge similar ones.
2. **Existing tabs on startup** — `startupScan()` classifies all non-grouped tabs when the extension loads.
3. **Ungrouped tab cleanup** — `periodicCleanup()` checks for tabs that have fallen through classification and assigns them to groups.
4. **Cost tracking** — API call counts and token estimates are persisted to storage and displayed in the options page.
5. **SPA Navigation Handling** — A content script (`content.js`) detects `pushState`/`popstate`/`hashchange` events and sends `spaNavigate` messages to the background script.
6. **Debounce on Rapid URL Changes** — A per-tab debounce timer prevents redundant classification during OAuth redirect chains or rapid location changes.
7. **Custom group rules** — Rules engine (`lib/rules-engine.js`) lets users define domain→group mappings with glob patterns, bypassing the LLM entirely for known sites.
8. **Toolbar popup** — Quick access popup (`popup.html`) with pause toggle, group stats, recent classifications, and a "Classify This Tab" button.
9. **Smart Tab Search** — Fuzzy-search quick switcher (`search.html`) via `Ctrl+Shift+K` for jumping between tabs across all windows.
10. **Group color customization** — Users can override deterministic hash colors per group via the cache dashboard color picker.
11. **Tab hibernation** — Auto-discards idle tabs in managed groups to free memory, with configurable idle threshold (10-minute alarm) and per-group opt-out.
12. **Import/export** — JSON export/import for both the domain→group cache and rules engine, enabling backup and migration.
13. **Extracted shared modules** — `lib/constants.js`, `lib/utils.js`, and `lib/rules-engine.js` eliminate duplication between background and options pages.
14. **Inline modals** — Blocking `confirm()` dialogs replaced with accessible inline modals on the options page.
15. **Unsaved-changes warning** — Beforeunload confirmation dialog on the options page when settings have been modified but not saved.
16. **Per-group tab counts** — Popup displays tab counts alongside group names (e.g., "GitHub (12)").
17. **Cost display** — Popup footer shows estimated LLM cost from token usage.
18. **Loading spinner** — Popup shows a spinner animation while state is loading.
19. **Classification failure notification** — Firefox notification when LLM classification fails after all retries.
20. **Recent classifications persistence** — Classification history survives browser restarts via storage persistence.

## Open questions

1. **LLM-assisted rule creation** — see Rules Engine section; design is ready,
   implementation is the remaining work.
2. **Multi-provider support** — Allow any OpenAI-compatible endpoint
   (OpenRouter, Together, Ollama, llama.cpp). Protocol is identical; just need
   configurable base URL + model + API key fields. Could ship with provider
   presets and auto-fetch pricing.
3. **Live cost tracking** — Replace hardcoded `TOKENS_CLASSIFY`/`TOKENS_MERGE`
   with actual `usage.total_tokens` from API responses. Replace hardcoded
   `COST_PER_TOKEN` with user-configurable $/M-token rate. See LLM API section.
4. **Manifest v3 migration** — Firefox is phasing out manifest v2. Migrating
   will require replacing background scripts with service workers (no DOM
   access, no `window`). **Deferred**: tracked separately.
5. **Cross-browser support** — Currently Firefox-only (`browser.*` API).
   Chrome compatibility (manifest v3, `chrome.*` API) would require a
   polyfill or separate build.
