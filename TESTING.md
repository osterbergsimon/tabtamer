# TabTamer — Manual Test Procedure

## Prerequisites
- Firefox (v85+ with tabGroups support)
- An opencode.ai API key

## Test 1: Temporary Add-on Loading

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `extension/manifest.json` from the TabTamer project directory
4. **Expected**: Extension appears in the list with name "TabTamer"
5. Check the browser console (Ctrl+Shift+J) for any errors
6. **Expected**: No errors related to TabTamer
   - Log message: `TabTamer: installed/updated — install`
   - If no API key is set: options page opens automatically

## Test 2: Options Page

1. Click the "Options" button next to TabTamer in `about:debugging`
   — OR navigate to `about:addons` → TabTamer → Preferences
2. **Expected**: Options page opens with:
   - API Key field (password type, empty)
   - Model dropdown (default: `deepseek-v4-flash`)
   - Extension enabled checkbox (checked by default)
   - Clear Cache button
   - Save button
3. Enter an API key, select a model, click Save
4. **Expected**: Green toast "Settings saved successfully"
5. Reload the page
6. **Expected**: Previously saved values are loaded
7. Click "Clear Cache"
8. **Expected**: Green toast "Domain cache cleared"

## Test 3: Tab Classification (requires API key)

1. Open Browser Console (Ctrl+Shift+J)
2. With the extension enabled and API key configured, open a new tab
   - Navigate to `https://github.com`, `https://news.ycombinator.com`, etc.
3. **Expected logs in Browser Console**:
   ```
   TabTamer: cache miss — <domain>, calling LLM
   TabTamer: calling LLM for <domain> (model: deepseek-v4-flash)
   TabTamer: classified <domain> → "GroupName"
   TabTamer: created new group "GroupName" (id: <n>)
   TabTamer: moved tab <id> to group "GroupName"
   ```
4. The tab should appear in a Firefox tab group with the classified name
5. Navigate to another URL on the same domain
6. **Expected logs**:
   ```
   TabTamer: cache hit — "GroupName" for <domain>
   TabTamer: found existing group "GroupName" (id: <n>)
   TabTamer: moved tab <id> to group "GroupName"
   ```

## Test 4: Enabled Toggle

1. Open the options page
2. Uncheck "Extension enabled", click Save
3. Open a new tab
4. **Expected**: No TabTamer processing logs appear in Browser Console
5. Re-check "Extension enabled", click Save
6. Open a new tab
7. **Expected**: Processing resumes (cache miss → LLM call → group assignment)

## Test 5: Disabled/Unauthenticated Behavior

1. Clear the API key in options, save
2. Open a new tab
3. **Expected**: 
   - Warning log: `TabTamer: API key not set — leaving tab ungrouped`
   - Notification: "Set your API key in TabTamer options to enable auto-grouping."
   - This notification shows only once per browser session

## Test 6: Error Handling

1. Disconnect from network, open a new tab
2. **Expected logs**:
   ```
   TabTamer: request error for <domain>, retrying in 1s (attempt 1)
   TabTamer: request error for <domain>, retrying in 2s (attempt 2)
   ...
   TabTamer: request error for <domain>, giving up after 5 attempts
   ```
3. Tab remains ungrouped

## Test 7: Startup Scan (Phase 2)

1. Open the Browser Console (Ctrl+Shift+J)
2. Close and reload the extension (click "Reload" next to TabTamer in `about:debugging`)
   — OR restart Firefox
3. **Expected logs**:
   ```
   TabTamer: browser started — running startup scan
   TabTamer: startup scan — found <n> ungrouped tabs
   TabTamer: startup scan complete
   ```
4. Any previously ungrouped tabs (not assigned to a group) should be classified and moved to tab groups
5. **Expected**: Existing grouped tabs are not re-processed

## Test 8: Periodic Cleanup (Phase 2)

1. Open the Browser Console
2. Open a new tab to a domain that hasn't been cached yet
   - Wait up to 15 minutes for the periodic cleanup alarm to fire
   - Or check the console for: `TabTamer: alarm fired — periodic cleanup`
3. **Expected logs** (when alarm fires):
   ```
   TabTamer: alarm fired — periodic cleanup
   TabTamer: periodic cleanup — found <n> ungrouped tabs
   TabTamer: periodic cleanup complete
   ```
4. Any tabs that were not classified when first opened (e.g., due to a transient error) should be classified during this cycle

## Test 9: Group Merge (Phase 2)

*Prerequisite: At least 2 tab groups with similar names (e.g., "Development" and "Dev work")*

1. Open the Browser Console
2. Wait up to 60 minutes for the group merge alarm to fire
   - Or check the console for: `TabTamer: alarm fired — group merge`
3. **Expected logs**:
   ```
   TabTamer: alarm fired — group merge
   TabTamer: group merge — analyzing <n> groups: [GroupA, GroupB, ...]
   TabTamer: group merge — renamed "<old name>" to "<new name>"
   TabTamer: group merge — complete, <n> group(s) renamed
   ```
4. **Alternative if groups are not similar**:
   ```
   TabTamer: group merge — no merges needed
   ```
5. **If extension is disabled or no API key**:
   ```
   TabTamer: group merge — extension disabled, skipping
   ```
   or
   ```
   TabTamer: group merge — no API key, skipping
   ```

## Test 10: Cost Tracking Display (Phase 2)

1. Open the options page
2. **Expected**: The "API Usage" card is visible below the settings form, showing:
   - Number of API calls: `<n> calls`
   - Estimated tokens: `~<n> tokens`
   - A "Reset costs" button
3. After opening new tabs that trigger classification (cache miss), the call count and token estimate should increase
4. Click "Reset costs"
5. **Expected**: Green toast "Costs reset"; counters show `0 calls` and `~0 tokens`
6. Reload the options page
7. **Expected**: Counters show the values from storage (starting at 0 after reset)

## Test 11: Theme Selector (Phase 2)

1. Open the options page
2. **Expected**: A "Theme" dropdown with three options: System, Light, Dark
3. Select "Dark"
4. **Expected**: The options page immediately switches to dark color scheme (dark background, light text)
5. Save settings and reload the page
6. **Expected**: Theme persists as "Dark" and is applied immediately on load
7. Select "Light"
8. **Expected**: The options page immediately switches to light color scheme (white background, dark text)
9. Select "System"
10. **Expected**: The options page follows the OS-level color scheme preference

## Test 12: SPA Navigation Handling

1. Open Browser Console (Ctrl+Shift+J)
2. Load a single-page application that uses client-side routing (e.g., any React/Angular/Vue app like `https://github.com` or `https://docs.npmjs.com`)
3. Navigate internally by clicking links (SPA route change)
4. **Expected logs**:
   ```
   TabTamer: SPA navigation in tab <n> — <new-url>
   TabTamer: cache <hit|miss> — <domain>, calling LLM
   ```
5. The tab should be correctly moved to the appropriate group based on the new URL

## Test 13: Debounce Behavior

1. Open Browser Console
2. Set up a redirect chain or rapidly change `location.href` in a tab (e.g., via a bookmarklet or devtools console: `location.href = 'https://example.com/page1'; setTimeout(() => location.href = 'https://example.com/page2', 50)`)
3. **Expected**: Only the final URL is classified; no intermediate classifications appear
4. Verify by checking that only one `TabTamer: cache miss — <domain>, calling LLM` log appears for the final URL
5. **Expected**: The debounce timer waits ~500ms after the last URL change before triggering classification

## Test 14: Cache Clear Confirmation Dialog

1. Open the options page
2. Click "Clear Cache"
3. **Expected**: A confirmation dialog (window.confirm) appears showing:
   - The number of cached entries, e.g., "Are you sure you want to clear the domain cache (42 entries)? This cannot be undone."
4. Click "Cancel"
5. **Expected**: Cache is not cleared; no toast appears
6. Click "Clear Cache" again, then click "OK" on the confirmation dialog
7. **Expected**: Green toast "Domain cache cleared"; cache counters show 0

## Test 15: Group Merge Tab Consolidation

*Prerequisite: At least 2 tab groups with similar names that should be merged (e.g., "Development" and "Development work")*

1. Open Browser Console
2. Trigger a group merge (wait for the 60-minute alarm or temporarily reduce the merge interval for testing)
3. **Expected logs**:
   ```
   TabTamer: group merge — moved <n> tab(s) from "Development work" to "Development"
   ```
4. After the merge, verify that the source group ("Development work") is gone (auto-deleted by Firefox when empty)
5. Verify that all tabs that were in the source group are now physically inside the target group ("Development")
6. **Expected**: Tab count in the target group increases by the number of tabs moved from the source group
7. **Alternative if no similar groups**: `TabTamer: group merge — no merges needed`

## Automated Verification Summary

The following have been verified automatically:

| Check | Status |
|-------|--------|
| manifest.json valid JSON | ✅ |
| background.js compiles | ✅ |
| options.js compiles | ✅ |
| options.html well-formed | ✅ |
| Storage keys consistent | ✅ (`tabtamerSettings`, `domainGroupCache`, `tabtamerCosts`) |
| All required functions defined | ✅ |
| All API permissions match usage | ✅ |
| Icon file (48×48 PNG) exists | ✅ |
| Extension loads without Firefox errors | ✅ |
| XPI package created | ✅ |
