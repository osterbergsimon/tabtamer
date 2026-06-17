# TabTamer — LLM-powered tab grouping for Firefox

## Overview

**TabTamer automatically categorizes open tabs into Firefox native tab groups.**
New tabs are classified by a rules engine (instant, free) or an LLM
(opencode-go) as a fallback. Domain→group mappings are cached, so the LLM is
only called once per domain. A toolbar popup gives at-a-glance visibility into
what's happening, and idle tabs in managed groups are automatically hibernated
to free memory.

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

### 3. Caching

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
    "enabled": true
  }
}
```

Cache is cleared when the extension updates or manually via options page.

### 4. Smart Tab Search (Quick Switcher)

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

### 5. Group Color Customization

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

## Flow

### New tab classification

```
1. tabs.onUpdated fires (or spaNavigate message from content script)
2. Parse URL → extract domain
3. Check storage.local cache for domain
   ├─ Hit  → use cached group name
   └─ Miss → call LLM API
4. Look up or create native tab group with that name
5. tabs.group({ tabId, groupId })
6. Save domain→group in cache
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
| Enabled | on | Pause auto-grouping temporarily |
| Clear cache | — | Reset all domain→group mappings |

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

All open questions from earlier phases have been addressed in Phases 2 and 3:

1. **Group merging** — `mergeSimilarGroups()` runs on a periodic alarm, re-classifying existing tab groups to merge similar ones.
2. **Existing tabs on startup** — `startupScan()` classifies all non-grouped tabs when the extension loads.
3. **Ungrouped tab cleanup** — `periodicCleanup()` checks for tabs that have fallen through classification and assigns them to groups.
4. **Cost tracking** — API call counts and token estimates are persisted to storage and displayed in the options page.
5. **SPA Navigation Handling** — A content script (`content.js`) detects `pushState`/`popstate`/`hashchange` events and sends `spaNavigate` messages to the background script.
6. **Debounce on Rapid URL Changes** — A per-tab debounce timer prevents redundant classification during OAuth redirect chains or rapid location changes.

## Open questions

1. **Manifest v3 migration** — Firefox is phasing out manifest v2. Migrating will require replacing `background.html` scripts with service workers (no DOM access, no `window`). **Deferred**: tracked separately, not in scope for Phase 8.
2. **Group naming conflicts** — When the LLM assigns a tab to a group that doesn't exist, a new group is created. Over time this can produce near-duplicates ("GitHub" vs "Github"). A name normalization step (T4.8) now trims and Title Cases names before group creation, which largely mitigates this. The periodic merge (`mergeSimilarGroups()`) catches any remaining overlaps.
