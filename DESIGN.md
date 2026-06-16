# TabTamer — LLM-powered tab grouping for Firefox

## Overview

Firefox extension that watches new tabs and auto-groups them using an LLM
(opencode-go). Each tab is classified into a short group name (e.g. "NixOS",
"GitHub", "Email") and placed into a Firefox native tab group. Domain→group
mappings are cached, so the LLM is only called once per domain.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Firefox                       │
│  ┌──────────┐    ┌──────────────┐               │
│  │ New tab  │──►│  TabTamer     │               │
│  │ created  │   │  extension    │               │
│  └──────────┘   │               │               │
│                 │ 1. Check      │               │
│                 │    cache      │               │
│                 │              │               │
│                 │ 2. Cache miss?               │
│                 │    fetch() ───┼───────────┐   │
│                 │               │           │   │
│                 │ 3. Create/use │  ┌────────▼──┐
│                 │    tab group  │  │ opencode   │
│                 │               │  │ API        │
│                 │ 4. Move tab   │  │ (Zen Go)   │
│                 │    into group │  │            │
│                 │               │  │ /chat/     │
│                 │ 5. Update     │  │ completions│
│                 │    cache      │  └────────────┘
│                 └──────────────┘               │
└─────────────────────────────────────────────────┘
```

No daemon, no native messaging, no CLI — entirely self-contained in the browser.

## Components

### 1. Firefox Extension (`tabtamer/`)

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (v2) with permissions |
| `background.js` | Background script: tab detection, LLM calls, group management |
| `options.html` | Settings page: API key entry, model selection, pause toggle |
| `options.js` | Settings page logic |

Permissions needed:
- `tabs` — detect new tabs
- `tabGroups` — create / manage Firefox native tab groups
- `storage` — cache domain→group mappings, settings
- `https://opencode.ai/*` — call the LLM API

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

1. **Manifest v3 migration** — Firefox is phasing out manifest v2. Migrating will require replacing `background.html` scripts with service workers (no DOM access, no `window`).
2. **Group naming conflicts** — When the LLM assigns a tab to a group that doesn't exist, a new group is created. Over time this can produce near-duplicates ("GitHub" vs "Github"). A name normalization step (T4.8) now trims and Title Cases names before group creation, which largely mitigates this. The periodic merge (`mergeSimilarGroups()`) catches any remaining overlaps.
