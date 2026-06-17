

// TabTamer — background script
// TAS-2: Tab detection + cache check
// TAS-3: LLM API call
// TAS-4: Native tab group management
// TAS-5: Enabled toggle
// TAS-6: Onboarding
// TAS-9: Error handling (exponential backoff, rate limiting, API key notification)

// ─── Constants are defined in lib/constants.js (loaded first via manifest) ────

// T5.6: Firefox-supported tab group colors for deterministic auto-assignment
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'purple', 'pink', 'green', 'orange', 'cyan'];

let _managedGroupIds = new Set();

// ─── Popup State Tracking (T7.10) ─────────────────────────────────────────────

// Last 5 successful classifications for the popup UI
let _recentClassifications = [];

// Pending classification count for processing indicator
let _pendingClassificationCount = 0;

// Flag to suppress missing-API-key notification during startup
let _startupInProgress = false;

// ─── Retry with Backoff ──────────────────────────────────────────────────────────
// T5.5: Unified retry loop with exponential backoff, rate-limit handling

async function retryWithBackoff(fetchFn, options = {}) {
  const maxRetries = options.maxRetries || MAX_RETRIES;
  const maxDelay = options.maxDelay || 30;
  let delay = options.initialDelay || 1;
  const label = options.label || 'request';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn();

      if (response.ok) {
        return response;
      }

      // Handle rate limiting (429) — respect Retry-After header
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) || delay : delay;
        console.warn(`TabTamer: ${label} — rate limited, waiting ${waitSeconds}s (attempt ${attempt})`);
        await sleep(waitSeconds * 1000);
        continue;
      }

      // Non-429 error — exponential backoff
      if (attempt < maxRetries) {
        console.warn(`TabTamer: ${label} — API error ${response.status}, retrying in ${delay}s (attempt ${attempt})`);
        await sleep(delay * 1000);
        delay = Math.min(delay * 2, maxDelay);
      } else {
        console.error(`TabTamer: ${label} — API error ${response.status}, giving up after ${attempt} attempts`);
        return null;
      }
    } catch (err) {
      // Network error, JSON parse error, etc.
      if (attempt < maxRetries) {
        console.warn(`TabTamer: ${label} — request error, retrying in ${delay}s (attempt ${attempt})`, err.message);
        await sleep(delay * 1000);
        delay = Math.min(delay * 2, maxDelay);
      } else {
        console.error(`TabTamer: ${label} — request error, giving up after ${attempt} attempts`, err);
        return null;
      }
    }
  }

  return null;
}

// ─── Group Color Assignment ─────────────────────────────────────────────────────
// T5.6: Deterministically derive a color from the group name for visual consistency

function getGroupColor(name) {
  // djb2 hash for deterministic color selection
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) + name.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

// ─── Group Name Normalization ──────────────────────────────────────────────────
// T4.8: Trim and Title Case group names to prevent near-duplicate groups

// ─── Managed Group Tracking ───────────────────────────────────────────────────
// T4.2: Track which group IDs TabTamer has created to respect manual groupings

async function loadManagedGroups() {
  try {
    const result = await browser.storage.local.get(MANAGED_GROUPS_KEY);
    _managedGroupIds = new Set(result[MANAGED_GROUPS_KEY] || []);
  } catch (err) {
    // T7.4: On failure, set to null (unknown state) instead of silently keeping
    // empty Set (which would cause ALL tabs in groups to be skipped as "manually managed")
    console.warn('TabTamer: loadManagedGroups — storage read failed, treating groups as unmanaged', err);
    _managedGroupIds = null;
  }
}

async function markGroupManaged(groupId) {
  if (!_managedGroupIds) _managedGroupIds = new Set();
  _managedGroupIds.add(groupId);
  try {
    await browser.storage.local.set({
      [MANAGED_GROUPS_KEY]: Array.from(_managedGroupIds)
    });
  } catch (err) {
    console.error('TabTamer: markGroupManaged error', err);
  }
}

// ─── Concurrency Limiter ─────────────────────────────────────────────────────
// Phase 2: Limit concurrent LLM classifications to 2

let concurrentClassifications = 0;

async function runWithConcurrencyLimit(fn) {
  while (concurrentClassifications >= MAX_CONCURRENT) {
    await sleep(CONCURRENCY_POLL_MS);
  }
  concurrentClassifications++;
  try {
    await fn();
  } finally {
    concurrentClassifications--;
  }
}

// ─── Tab Query Helper ─────────────────────────────────────────────────────────
// T3.7: Reusable function to get ungrouped, non-internal tabs

async function getUngroupedTabs() {
  // T5.4: Use server-side filter for ungrouped tabs instead of JS filtering
  const tabs = await browser.tabs.query({ groupId: -1 });
  return tabs.filter(tab => {
    if (!tab.url) return false;
    if (tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) return false;
    return true;
  });
}

// ─── Startup Scan ─────────────────────────────────────────────────────────────
// Phase 2: Classify all ungrouped tabs on browser start or install

async function startupScan() {
  // T5.10: Show processing indicator in toolbar badge during startup scan
  // The first handleTab() call will set up the processing indicator
  // via the _pendingClassificationCount tracking mechanism (T7.12).
  // Use a minimal initial badge to provide immediate visual feedback.
  browser.browserAction.setBadgeText({ text: '…' });
  browser.browserAction.setBadgeBackgroundColor({ color: '#888888' });

  try {
    const ungroupedTabs = await getUngroupedTabs();

    console.log(`TabTamer: startup scan — found ${ungroupedTabs.length} ungrouped tabs`);

    // Process each ungrouped tab with concurrency limiting
    // Each handleTab() call increments _pendingClassificationCount
    // and calls updateBadge(true) for the processing indicator
    const promises = ungroupedTabs.map(tab =>
      runWithConcurrencyLimit(() => handleTab(tab.id, tab.url, tab.title))
    );
    await Promise.all(promises);
    console.log('TabTamer: startup scan complete');
  } catch (err) {
    console.error('TabTamer: startup scan error', err);
  } finally {
    // Restore normal badge (group count or OFF) after scan completes
    await updateBadge(false);
  }
}

// ─── Debounce Map ────────────────────────────────────────────────────────────
// T3.6: Per-tab debounce for rapid URL changes (e.g. OAuth redirect chains)

const _debounceTimers = new Map();

// ─── Dedup Set ───────────────────────────────────────────────────────────────
// T3.1: Prevent concurrent handleTab() calls on the same tab ID

const _processingTabs = new Set();

// ─── Tab Listeners ───────────────────────────────────────────────────────────
// TAS-2: Watch new tabs and classify them

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Process when URL changes to a real page
  if (changeInfo.url && tab.url) {
    // T3.6: Debounce rapid URL changes — only classify the final URL in a burst
    if (_debounceTimers.has(tabId)) {
      clearTimeout(_debounceTimers.get(tabId));
    }
    _debounceTimers.set(tabId, setTimeout(() => {
      _debounceTimers.delete(tabId);
      runWithConcurrencyLimit(() => handleTab(tabId, tab.url, tab.title));
    }, DEBOUNCE_MS));
  }
});

// T6.5: Clean up debounce timers when tabs are closed
browser.tabs.onRemoved.addListener((tabId) => {
  if (_debounceTimers.has(tabId)) {
    clearTimeout(_debounceTimers.get(tabId));
    _debounceTimers.delete(tabId);
    console.log(`TabTamer: tab ${tabId} closed — cancelled pending debounce timer`);
  }
});

// T3.4: Handle SPA navigations from content script
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'spaNavigate' && sender.tab && sender.tab.id && sender.tab.url) {
    const tabId = sender.tab.id;
    console.log(`TabTamer: SPA navigation in tab ${tabId} — ${sender.tab.url}`);
    runWithConcurrencyLimit(() => handleTab(tabId, sender.tab.url, sender.tab.title));
  }

  // T7.10: Popup state queries
  if (message.type === 'getPopupState') {
    return getPopupState();
  }

  if (message.type === 'togglePause') {
    return togglePause();
  }
});

// T7.10: Popup state response
async function getPopupState() {
  try {
    const enabled = await isEnabled();

    // Query only TabTamer-managed groups
    let groupNames = [];
    try {
      const groups = await browser.tabGroups.query({});
      groupNames = groups
        .filter(g => _managedGroupIds && _managedGroupIds.has(g.id))
        .map(g => g.title)
        .filter(Boolean);
    } catch (err) {
      console.warn('TabTamer: getPopupState — error querying groups', err.message);
    }

    return {
      enabled,
      managedGroupCount: groupNames.length,
      managedGroupNames: groupNames,
      recentClassifications: _recentClassifications,
      processingCount: _pendingClassificationCount
    };
  } catch (err) {
    console.error('TabTamer: getPopupState error', err);
    return {
      enabled: false,
      managedGroupCount: 0,
      managedGroupNames: [],
      recentClassifications: [],
      processingCount: 0
    };
  }
}

// T7.10: Toggle pause state
async function togglePause() {
  try {
    const settings = await getSettings();
    const newEnabled = !(settings.enabled !== false);
    settings.enabled = newEnabled;
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
    console.log(`TabTamer: ${newEnabled ? 'enabled' : 'disabled'} via popup toggle`);
    await updateBadge();
    return { enabled: newEnabled };
  } catch (err) {
    console.error('TabTamer: togglePause error', err);
    return { enabled: false, error: err.message };
  }
}

// ─── Browser Action Click ─────────────────────────────────────────────────
// T4.13: Open options page when toolbar icon is clicked (only if no popup is set)
// T7.10: With default_popup set in manifest, this listener is no longer needed.
// The popup.html handles the click and provides a link to options.

// ─── Toolbar Badge ───────────────────────────────────────────────────────────
// T4.7: Show badge on toolbar icon — OFF when disabled, group count when enabled
// T6.6: Debounce updateBadge calls — trailing 500ms to coalesce rapid bursts

let _badgeDebounceTimer = null;

function updateBadge(processing) {
  if (_badgeDebounceTimer) {
    clearTimeout(_badgeDebounceTimer);
  }
  _badgeDebounceTimer = setTimeout(async () => {
    _badgeDebounceTimer = null;
    try {
      const enabled = await isEnabled();
      if (!enabled) {
        browser.browserAction.setBadgeText({ text: 'OFF' });
        browser.browserAction.setBadgeBackgroundColor({ color: '#888888' });
      } else {
        // T7.13: Show only TabTamer-managed groups count
        const groups = await browser.tabGroups.query({});
        const managedCount = groups.filter(g => _managedGroupIds && _managedGroupIds.has(g.id)).length;
        // T7.12: Show processing indicator if classifications are in-flight
        // Use the passed flag if provided, otherwise fall back to tracking counter
        const isProcessing = processing !== undefined ? processing : _pendingClassificationCount > 0;
        if (isProcessing) {
          browser.browserAction.setBadgeText({ text: `${managedCount}…` });
        } else {
          browser.browserAction.setBadgeText({ text: managedCount > 0 ? String(managedCount) : '' });
        }
        browser.browserAction.setBadgeBackgroundColor({ color: '#34c759' });
      }
    } catch (err) {
      console.error('TabTamer: updateBadge error', err);
    }
  }, 500);
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────────────
// T4.5: Handle command shortcuts defined in manifest.json

browser.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-tabtamer') {
    try {
      const settings = await getSettings();
      settings.enabled = !(settings.enabled !== false);
      await browser.storage.local.set({ [SETTINGS_KEY]: settings });
      console.log(`TabTamer: ${settings.enabled ? 'enabled' : 'disabled'} via keyboard shortcut`);
    } catch (err) {
      console.error('TabTamer: toggle via keyboard shortcut failed', err);
    }
  } else if (command === 'open-tabtamer-options') {
    browser.runtime.openOptionsPage();
  } else if (command === 'tabtamer-search') {
    browser.tabs.create({ url: browser.runtime.getURL('search.html') });
  }
});

// ─── Main processing pipeline ────────────────────────────────────────────────

async function handleTab(tabId, url, title) {
  // T3.1: Prevent duplicate processing of the same tab
  if (_processingTabs.has(tabId)) {
    console.log(`TabTamer: tab ${tabId} already being processed — skipping`);
    return;
  }
  _processingTabs.add(tabId);
  // T7.12: Track pending classification count and show processing indicator
  _pendingClassificationCount++;
  updateBadge(true);

  try {
    // TAS-5: Check if extension is enabled
    if (!(await isEnabled())) return;

    // T4.2: Skip tabs in manually-managed groups (user-created groups)
    try {
      const tabInfo = await browser.tabs.get(tabId);
      if (tabInfo.groupId > 0 && _managedGroupIds !== null && !_managedGroupIds.has(tabInfo.groupId)) {
        console.log(`TabTamer: tab ${tabId} in manually-managed group — skipping`);
        return;
      }
    } catch (tabErr) {
      // Tab was closed, skip
      if (tabErr.message && tabErr.message.includes('Invalid tab ID')) {
        return;
      }
    }

    // TAS-2: Parse domain from URL
    const domain = extractDomain(url);
    if (!domain) {
      // TAS-9: Invalid URL → skip silently
      return;
    }

    // T6.9: Skip classification for excluded domains (privacy)
    if (await isDomainExcluded(domain)) {
      console.log(`TabTamer: domain excluded — ${domain}, skipping classification`);
      return;
    }

    // T7.9: Check custom rules BEFORE cache and LLM — first match wins
    const ruleGroup = await TabTamerRules.matchRules(domain);
    if (ruleGroup) {
      console.log(`TabTamer: rule match — "${ruleGroup}" for ${domain}`);
      try {
        await assignToGroup(tabId, ruleGroup);
      } catch (err) {
        if (err.message && err.message.includes('Invalid tab ID')) {
          console.log(`TabTamer: tab ${tabId} closed before rule assignment`);
          return;
        }
        throw err;
      }
      return;
    }

    // TAS-2: Check cache
    const cachedGroup = await getCachedGroup(domain);
    if (cachedGroup) {
      console.log(`TabTamer: cache hit — "${cachedGroup}" for ${domain}`);

      // T3.2: Skip regroup if tab is already in a group with the cached name
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.groupId && tab.groupId > 0) {
          const groups = await browser.tabGroups.query({ id: tab.groupId });
          if (groups.length > 0 && groups[0].title === cachedGroup) {
            console.log(`TabTamer: tab ${tabId} already in group "${cachedGroup}" — skipping`);
            return;
          }
        }
      } catch (err) {
        // If tab was closed or group query fails, continue to assign
        if (err.message && err.message.includes('Invalid tab ID')) {
          console.log(`TabTamer: tab ${tabId} closed before classification`);
          return;
        }
      }

      // TAS-4: Assign to existing group
      try {
        await assignToGroup(tabId, cachedGroup);
      } catch (err) {
        if (err.message && err.message.includes('Invalid tab ID')) {
          console.log(`TabTamer: tab ${tabId} closed before classification`);
          return;
        }
        throw err;
      }
      return;
    }

    // TAS-3: Not cached — call LLM API
    console.log(`TabTamer: cache miss — ${domain}, calling LLM`);
    try {
      await classifyAndAssign(tabId, url, title, domain);
    } catch (err) {
      if (err.message && err.message.includes('Invalid tab ID')) {
        console.log(`TabTamer: tab ${tabId} closed before classification`);
        return;
      }
      throw err;
    }
  } finally {
    _processingTabs.delete(tabId);
    // T7.12: Decrement pending classification count and update badge
    _pendingClassificationCount = Math.max(0, _pendingClassificationCount - 1);
    updateBadge(_pendingClassificationCount > 0);
  }
}

// ─── Domain Exclusion List (T6.9) ───────────────────────────────────────────
// Privacy feature: skip classification for sensitive domains

async function isDomainExcluded(domain) {
  try {
    const result = await browser.storage.local.get(EXCLUDED_DOMAINS_KEY);
    const excluded = result[EXCLUDED_DOMAINS_KEY] || [];
    for (const pattern of excluded) {
      if (pattern.startsWith('*.')) {
        // Wildcard match: *.domain.com matches sub.domain.com, foo.bar.domain.com, etc.
        const suffix = pattern.slice(1); // remove the '*'
        if (domain.endsWith(suffix)) {
          return true;
        }
      } else {
        // Exact match
        if (domain === pattern) {
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    console.error('TabTamer: isDomainExcluded error', err);
    return false;
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// TAS-2: Read/write domain→group mappings in browser.storage.local

async function getCachedGroup(domain) {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    return cache[domain] || null;
  } catch (err) {
    console.error('TabTamer: cache read error', err);
    return null;
  }
}

async function setCachedGroup(domain, groupName) {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    cache[domain] = groupName;
    await browser.storage.local.set({ [CACHE_KEY]: cache });
  } catch (err) {
    console.error('TabTamer: cache write error', err);
  }
}

async function removeCachedGroup(domain) {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    if (domain in cache) {
      delete cache[domain];
      await browser.storage.local.set({ [CACHE_KEY]: cache });
      console.log(`TabTamer: removed ${domain} from cache`);
    }
  } catch (err) {
    console.error('TabTamer: removeCachedGroup error', err);
  }
}

// ─── Enabled Check ───────────────────────────────────────────────────────────
// TAS-5: Read enabled flag from settings; default to true

async function isEnabled() {
  try {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || {};
    return settings.enabled !== false; // default enabled
  } catch (err) {
    console.warn('TabTamer: isEnabled — storage error, defaulting to enabled', err);
    return true; // safe default: extension stays enabled
  }
}

// ─── Settings Reader ─────────────────────────────────────────────────────────
// TAS-3: Read full settings object (apiKey, model, enabled, etc.)

async function getSettings() {
  try {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] || {};
  } catch (err) {
    console.error('TabTamer: settings read error', err);
    return {};
  }
}

// ─── Settings change listener ────────────────────────────────────────────────
// TAS-5: Re-read settings when they change

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[SETTINGS_KEY]) {
    const newSettings = changes[SETTINGS_KEY].newValue || {};
    const enabled = newSettings.enabled !== false;

    if (enabled && !newSettings.apiKey) {
      console.warn('TabTamer: extension is enabled but no API key is set — auto-grouping will not work');
    } else {
      console.log(`TabTamer: extension ${enabled ? 'enabled' : 'disabled'} (via settings change)`);
    }
    // T4.7: Update toolbar badge on settings change
    updateBadge();
  }
});

// ─── Group Assignment ────────────────────────────────────────────────────────
// TAS-4: Search for existing group by name, create if missing, move tab

async function assignToGroup(tabId, groupName) {
  try {
    // T4.8: Normalize group name before querying/creating
    groupName = normalizeGroupName(groupName);

    // Search for existing group by name
    const groups = await browser.tabGroups.query({ title: groupName });

    let groupId;
    if (groups.length > 0) {
      // Reuse first matching group
      groupId = groups[0].id;
      console.log(`TabTamer: found existing group "${groupName}" (id: ${groupId})`);
    } else {
      // Create new group in the tab's window with deterministic color
      // T7.1: Wrap inner tabs.get in try/catch — tab may close between outer guard and here
      let tab;
      try {
        tab = await browser.tabs.get(tabId);
      } catch (getErr) {
        console.log(`TabTamer: tab ${tabId} closed before group creation`);
        return;
      }
      const groupColor = getGroupColor(groupName);
      const newGroup = await browser.tabGroups.create({
        title: groupName,
        windowId: tab.windowId,
        color: groupColor
      });
      groupId = newGroup.id;
      console.log(`TabTamer: created new group "${groupName}" (id: ${groupId}, color: ${groupColor})`);
    }

    // T5.6: Ensure existing groups without a color get one assigned
    try {
      const currentGroup = await browser.tabGroups.get(groupId);
      if (!currentGroup.color) {
        const assignedColor = getGroupColor(groupName);
        await browser.tabGroups.update(groupId, { color: assignedColor });
        console.log(`TabTamer: assigned color "${assignedColor}" to existing group "${groupName}"`);
      }
    } catch (grpErr) {
      console.warn(`TabTamer: could not update color for group "${groupName}"`, grpErr.message);
    }

    // T4.2: Track this group as TabTamer-managed
    await markGroupManaged(groupId);

    // T4.7: Update badge after group creation/reuse
    updateBadge();

    // Move tab into the group
    await browser.tabs.group({ tabIds: [tabId], groupId });
    console.log(`TabTamer: moved tab ${tabId} to group "${groupName}"`);
  } catch (err) {
    if (err.message && err.message.includes('Invalid tab ID')) {
      console.log(`TabTamer: tab ${tabId} closed before classification`);
      return;
    }
    console.error(`TabTamer: failed to assign tab ${tabId} to group "${groupName}"`, err);
  }
}

// ─── LLM Classification ─────────────────────────────────────────────────────
// TAS-3: Call opencode.ai LLM API to classify URL into a group name

async function classifyAndAssign(tabId, url, title, domain) {
  try {
    // Early check: if tab no longer exists, skip API call to avoid wasting costs
    try {
      await browser.tabs.get(tabId);
    } catch (tabErr) {
      console.log(`TabTamer: tab ${tabId} closed before classification — skipping`);
      return;
    }

    // Read API key from settings
    const settings = await getSettings();
    const apiKey = settings.apiKey;

    if (!apiKey) {
      console.warn('TabTamer: API key not set — leaving tab ungrouped');
      // TAS-9: Notify user once about missing API key
      await notifyMissingApiKey();
      return;
    }

    // Read model from settings, default to deepseek-v4-flash
    const model = settings.model || 'deepseek-v4-flash';

    // System prompt: classify into 1-3 word group name, Title Case
    // T4.6: Include existing group names to reduce proliferation
    const allGroups = await browser.tabGroups.query({});
    const existingNames = allGroups.map(g => g.title).filter(Boolean);

    const systemPrompt = existingNames.length > 0
      ? `Classify the following tab URL into a short group name (1-3 words, Title Case). Prefer reusing an existing group if applicable. Existing groups: [${existingNames.join(', ')}]. Only create a new name if none fit. Return ONLY the group name.`
      : 'Classify the following tab URL into a short group name (1-3 words, Title Case). Respond with only the group name.';
    const userMessage = `URL: ${url}\nTitle: ${title || '(no title)'}`;

    console.log(`TabTamer: calling LLM for ${domain} (model: ${model})`);

    // T5.5: Use unified retry-with-backoff instead of inline duplicate
    const response = await retryWithBackoff(() => fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 20,
        temperature: 0
      })
    }), { label: `classification for ${domain}` });

    if (!response) {
      return; // All retries exhausted — leave tab ungrouped
    }

    const data = await response.json();
    const groupName = data.choices?.[0]?.message?.content?.trim();

    if (!groupName) {
      console.warn(`TabTamer: empty LLM response for ${domain}`);
      // T7.2: Still track cost — tokens were consumed by the API call
      await updateCosts(TOKENS_CLASSIFY);
      return; // Leave tab ungrouped
    }

    // T4.8: Normalize group name before caching/assigning
    const normalizedName = normalizeGroupName(groupName);
    console.log(`TabTamer: classified ${domain} → "${normalizedName}"`);

    // Track cost only for successful classifications (not retries)
    await updateCosts(TOKENS_CLASSIFY);
    await setCachedGroup(domain, normalizedName);
    await assignToGroup(tabId, normalizedName);

    // T7.10: Track this classification for the popup
    _recentClassifications.unshift({
      domain,
      group: normalizedName,
      timestamp: Date.now()
    });
    if (_recentClassifications.length > 5) {
      _recentClassifications.pop();
    }
  } catch (err) {
    console.error(`TabTamer: classification error for ${domain}`, err);
    // Leave tab ungrouped on error
  }
}

// ─── Missing API Key Notification ────────────────────────────────────────────
// TAS-9: Notify the user once when API key is not set

async function notifyMissingApiKey() {
  try {
    const result = await browser.storage.local.get('tabtamerNotifiedNoApiKey');
    if (result.tabtamerNotifiedNoApiKey) {
      return; // Already notified once
    }

    await browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'TabTamer',
      message: 'Set your API key in TabTamer options to enable auto-grouping.'
    });

    await browser.storage.local.set({ tabtamerNotifiedNoApiKey: true });
    console.log('TabTamer: notified user about missing API key');
  } catch (err) {
    console.error('TabTamer: notifyMissingApiKey error', err);
  }
}

// ─── Alarms ─────────────────────────────────────────────────────────────────
// Phase 2: Periodic cleanup & group merging

// T4.9: Helper to create all periodic alarms (used by onStartup and onInstalled)
function createAlarms() {
  browser.alarms.create('cleanup', { periodInMinutes: CLEANUP_INTERVAL_MIN });
  browser.alarms.create('merge', { periodInMinutes: MERGE_INTERVAL_MIN });
  browser.alarms.create('cost-log', { periodInMinutes: COST_LOG_INTERVAL_MIN });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    console.log('TabTamer: alarm fired — periodic cleanup');
    periodicCleanup();
  } else if (alarm.name === 'merge') {
    console.log('TabTamer: alarm fired — group merge');
    mergeSimilarGroups();
  } else if (alarm.name === 'cost-log') {
    console.log('TabTamer: alarm fired — cost summary');
    logCostSummary();
  }
});

// ─── Cost Tracking ──────────────────────────────────────────────────────
// Phase 2: Track cumulative API calls and estimated token usage

async function updateCosts(tokens) {
  try {
    const result = await browser.storage.local.get(COSTS_KEY);
    const costs = result[COSTS_KEY] || { calls: 0, estimatedTokens: 0 };
    costs.calls += 1;
    costs.estimatedTokens += tokens;
    await browser.storage.local.set({ [COSTS_KEY]: costs });
  } catch (err) {
    console.error('TabTamer: cost tracking error', err);
  }
}

async function logCostSummary() {
  try {
    const result = await browser.storage.local.get(COSTS_KEY);
    const costs = result[COSTS_KEY] || { calls: 0, estimatedTokens: 0 };
    console.log(`TabTamer: cost summary — ${costs.calls} API calls, ~${costs.estimatedTokens} estimated tokens`);
  } catch (err) {
    console.error('TabTamer: cost summary error', err);
  }
}

// ─── Periodic Cleanup ────────────────────────────────────────────────────────
// Phase 2: Reclassify ungrouped tabs every 15 minutes

async function periodicCleanup() {
  try {
    const ungroupedTabs = await getUngroupedTabs();

    console.log(`TabTamer: periodic cleanup — found ${ungroupedTabs.length} ungrouped tabs`);

    const promises = ungroupedTabs.map(tab =>
      runWithConcurrencyLimit(() => handleTab(tab.id, tab.url, tab.title))
    );
    await Promise.all(promises);
    console.log('TabTamer: periodic cleanup complete');
  } catch (err) {
    console.error('TabTamer: periodic cleanup error', err);
  }
}

// ─── Group Merging ───────────────────────────────────────────────────────────
// Phase 2: LLM-based merge of similar tab groups

async function mergeSimilarGroups() {
  try {
    // Check if extension is enabled
    if (!(await isEnabled())) {
      console.log('TabTamer: group merge — extension disabled, skipping');
      return;
    }

    // Check API key
    const settings = await getSettings();
    const apiKey = settings.apiKey;
    if (!apiKey) {
      console.log('TabTamer: group merge — no API key, skipping');
      return;
    }

    const model = settings.model || 'deepseek-v4-flash';

    // Query all groups
    const groups = await browser.tabGroups.query({});

    if (groups.length <= 1) {
      console.log('TabTamer: group merge — only 1 group, skipping');
      return;
    }

    // Count tabs per group to filter out singletons
    // T5.4: Use per-group queries instead of fetching all tabs
    const tabCountByGroup = {};
    for (const g of groups) {
      const tabsInGroup = await browser.tabs.query({ groupId: g.id });
      tabCountByGroup[g.id] = tabsInGroup.length;
    }

    // Filter to groups with ≥2 tabs
    const mergeableGroups = groups.filter(g => (tabCountByGroup[g.id] || 0) >= 2);

    if (mergeableGroups.length <= 1) {
      console.log('TabTamer: group merge — only 1 mergeable group, skipping');
      return;
    }

    const groupNames = mergeableGroups.map(g => g.title);
    console.log(`TabTamer: group merge — analyzing ${groupNames.length} groups: [${groupNames.join(', ')}]`);

    // Build the merge prompt
    const systemPrompt = 'You are merging similar tab groups. Given these group names, output a JSON object mapping each original name to either its original name (if no merge needed) or the merged name (if it should join another group). Example: {"GitHub PRs": "GitHub", "NixOS": "NixOS"}.';
    const userMessage = `Group names: [${groupNames.join(', ')}]`;

    // T5.5: Use unified retry-with-backoff instead of inline duplicate; use MAX_RETRIES constant
    const response = await retryWithBackoff(() => fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 200,
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    }), { maxRetries: MAX_RETRIES, label: 'group merge' });

    if (!response) {
      return; // All retries exhausted — leave without merging
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.warn('TabTamer: group merge — empty LLM response');
      return; // Leave without merging
    }

    let mergeMap;
    try {
      mergeMap = JSON.parse(content);
    } catch (parseErr) {
      console.error('TabTamer: group merge — invalid JSON response', parseErr);
      return; // Leave without merging
    }

    if (!mergeMap || typeof mergeMap !== 'object') {
      console.error('TabTamer: group merge — unexpected response format');
      return; // Leave without merging
    }

    // Track cost only for successful merges (not retries)
    await updateCosts(TOKENS_MERGE);

    // Apply merges: move tabs from source groups into target groups
    let mergeCount = 0;
    for (const group of mergeableGroups) {
      const newName = normalizeGroupName(mergeMap[group.title] || '');
      if (!newName || newName === group.title) continue; // No merge needed for this group

      // Find an existing group with the target name
      const targetGroups = await browser.tabGroups.query({ title: newName });

      if (targetGroups.length > 0 && targetGroups[0].id !== group.id) {
        // Target group exists and is different → merge tabs into it
        const targetGroupId = targetGroups[0].id;
        const tabsInGroup = await browser.tabs.query({ groupId: group.id });
        const tabIds = tabsInGroup.map(t => t.id);

        if (tabIds.length > 0) {
          await browser.tabs.group({ tabIds, groupId: targetGroupId });
          console.log(`TabTamer: group merge — moved ${tabIds.length} tab(s) from "${group.title}" to "${newName}"`);
        }
      } else {
        // No distinct target group found → rename this group to the new name
        await browser.tabGroups.update(group.id, { title: newName });
        console.log(`TabTamer: group merge — renamed "${group.title}" to "${newName}" (no target group to merge into)`);
      }

      // Update cache entries referencing the old name
      await updateCacheForRename(group.title, newName);
      mergeCount++;
    }

    if (mergeCount === 0) {
      console.log('TabTamer: group merge — no merges needed');
    } else {
      console.log(`TabTamer: group merge — complete, ${mergeCount} group(s) merged/renamed`);
    }

    // T5.6: Assign colors to any groups still missing them after merge
    await assignColorsToGroups();

    // T4.7: Update badge after group merge
    updateBadge();
  } catch (err) {
    console.error('TabTamer: group merge error', err);
  }
}

// T5.6: One-time migration — assign colors to existing groups that lack one
async function assignColorsToGroups() {
  try {
    const groups = await browser.tabGroups.query({});
    let updatedCount = 0;
    for (const group of groups) {
      if (!group.color && group.title) {
        const color = getGroupColor(group.title);
        await browser.tabGroups.update(group.id, { color });
        updatedCount++;
      }
    }
    if (updatedCount > 0) {
      console.log(`TabTamer: assigned colors to ${updatedCount} existing group(s)`);
    }
  } catch (err) {
    console.error('TabTamer: assignColorsToGroups error', err);
  }
}

async function updateCacheForRename(oldName, newName) {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    let updatedCount = 0;
    for (const [domain, groupName] of Object.entries(cache)) {
      if (groupName === oldName) {
        cache[domain] = newName;
        updatedCount++;
      }
    }
    if (updatedCount > 0) {
      await browser.storage.local.set({ [CACHE_KEY]: cache });
      console.log(`TabTamer: group merge — updated cache for ${updatedCount} domain(s) from "${oldName}" to "${newName}"`);
    }
  } catch (err) {
    console.error('TabTamer: cache update for rename error', err);
  }
}

// ─── Context Menu (Re-classify) ──────────────────────────────────────────────
// T5.8: Manual re-classification via right-click context menu on tabs

try {
  browser.contextMenus.create({
    id: 'reclassify-tabtamer',
    title: 'Re-classify with TabTamer',
    contexts: ['tab']
  });
} catch (err) {
  console.error('TabTamer: context menu creation error', err);
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'reclassify-tabtamer') {
    const url = tab.url;
    if (!url) {
      console.log('TabTamer: re-classify — tab has no URL');
      return;
    }

    const domain = extractDomain(url);
    if (!domain) {
      console.log('TabTamer: re-classify — cannot extract domain from URL', url);
      return;
    }

    // Remove domain from cache to force re-classification
    await removeCachedGroup(domain);
    console.log(`TabTamer: re-classify — removed ${domain} from cache, triggering fresh classification`);

    // Trigger fresh classification of the tab
    runWithConcurrencyLimit(() => handleTab(tab.id, url, tab.title));
  }
});

// ─── Startup & Install ───────────────────────────────────────────────────────
// Phase 2: Scan ungrouped tabs on startup/install; continue onboarding

browser.runtime.onStartup.addListener(async () => {
  console.log('TabTamer: browser started — running startup scan');
  // T3.5: Clear the "notified no API key" flag so users get one fresh reminder per session
  browser.storage.local.remove('tabtamerNotifiedNoApiKey');
  // T4.2: Load managed group IDs from storage BEFORE startup scan
  await loadManagedGroups();
  // T5.6: Assign colors to existing groups without one
  assignColorsToGroups();
  // T5.10: startupScan() sets badge to "…" and calls updateBadge() on completion
  startupScan();
  // Phase 2: Create periodic alarms
  createAlarms();
});

browser.runtime.onInstalled.addListener(async (details) => {
  console.log('TabTamer: installed/updated —', details.reason);

  try {
    const settings = await getSettings();
    if (!settings.apiKey) {
      // Open options page so user can set up their API key
      await browser.runtime.openOptionsPage();

      // Show a notification prompting setup
      browser.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'TabTamer',
        message: 'Set up TabTamer — add your API key to start auto-grouping tabs.'
      });
    }

    // T4.2: Load managed group IDs from storage
    await loadManagedGroups();

    // T5.6: Assign colors to existing groups without one (one-time migration)
    assignColorsToGroups();

    // T5.10: startupScan() sets badge to "…" and calls updateBadge() on completion
    // Run startup scan on install/update to classify existing tabs
    startupScan();

    // Phase 2: Create periodic alarms (only on install or update, not browser_update)
    if (details.reason === 'install' || details.reason === 'update') {
      createAlarms();
    }
  } catch (err) {
    console.error('TabTamer: onboarding error', err);
  }
});
