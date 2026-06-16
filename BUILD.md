# TabTamer — build instructions

## Quick start

```bash
# Install iteratr (if not already)
bun add -g iteratr
# or: curl -sSL https://raw.githubusercontent.com/mark3labs/iteratr/refs/heads/master/install.sh | sh

# Build the extension
cd ~/code/tabtamer
iteratr build --spec specs/SPEC.md
```

This runs opencode in a loop. It will:
1. Read `specs/SPEC.md` for requirements
2. Read `DESIGN.md` for architecture
3. Create tasks from the spec
4. Build the extension files iteratively
5. Verify each step before moving on

## Manual test

After iteratr finishes, load the extension in Firefox:

1. Open Firefox → `about:debugging` → "This Firefox" → "Load Temporary Add-on"
2. Select `~/code/tabtamer/extension/manifest.json`
3. Open the extension options (click puzzle piece → TabTamer → gear)
4. Paste your opencode-go API key (from `~/.local/share/opencode/auth.json`)
5. Open a new tab → check console for classification logs
