

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

// T9.16: Timestamp tracking for throttling classification failure notifications
let _lastClassifyFailureNotification = 0;

// T10.10: Track context menu item IDs for the "Move to group…" submenu
let _moveToGroupMenuItems = [];

// T10.8: Per-session set of domains for which we've already shown a rule suggestion
// Prevents showing the same suggestion multiple times in one browser session
let _suggestedDomains = new Set();

// T10.8: In-memory map of dismissed rule suggestions (domain → timestamp)
// Loaded from storage on startup. Pruned of entries older than 30 days.
let _dismissedRuleSuggestions = {};

// T10.8: Map of active notification IDs to their suggestion data
// notificationId → { domain, groupName, timestamp }
// Used by the onClicked handler to approve rules
let _pendingSuggestionNotificationIds = new Map();

// T9.10: Helper to add a classification entry with overflow trim
function _addRecentClassification(entry) {
  _recentClassifications.unshift(entry);
  if (_recentClassifications.length > MAX_RECENT) {
    _recentClassifications.pop();
  }
  // T9.15: Persist to storage so recent classifications survive browser restarts
  persistRecentClassifications();
}

// T9.15: Load recent classifications from storage (call on startup/install)
async function loadRecentClassifications() {
  try {
    const result = await browser.storage.local.get(RECENT_CLASSIFICATIONS_KEY);
    _recentClassifications = result[RECENT_CLASSIFICATIONS_KEY] || [];
  } catch (err) {
    console.warn('TabTamer: loadRecentClassifications — storage read failed', err);
    _recentClassifications = [];
  }
}

// T9.15: Persist recent classifications to storage (fire-and-forget, non-critical)
function persistRecentClassifications() {
  browser.storage.local.set({ [RECENT_CLASSIFICATIONS_KEY]: _recentClassifications })
    .catch(err => console.warn('TabTamer: persistRecentClassifications — storage write failed', err));
}

// Pending classification count for processing indicator
let _pendingClassificationCount = 0;

// T10.12: Startup scan progress tracking for popup display
// { processed, total } or null when no startup scan is running
let _startupProgress = null;

// Custom group colors override (group name → color)
let _customGroupColors = null;

// ─── Tab Hibernation Engine (T9.19) ──────────────────────────────────────────

// In-memory tracking of tab access times (tabId → timestamp)
let _lastAccessTimes = {};

// Timer for throttled persistence to storage (max once per 30s)
let _lastAccessStorageTimer = null;

// Count of tabs hibernated in this session
let _hibernatedCount = 0;
// Flag to show hibernation indicator in badge (T11.1)
let _hibernationBadgeActive = false;

// ─── Domain Exclusion List (T9.3) ─────────────────────────────────────────────
// In-memory lookup structures for O(1) exact-match and O(n) wildcard matching
let _exactExcludedDomains = new Set();
let _wildcardExcludedDomains = [];

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
        const retryAfterParsed = retryAfter !== null ? parseInt(retryAfter, 10) : NaN;
        const waitSeconds = !isNaN(retryAfterParsed) ? retryAfterParsed : delay;
        console.warn(`TabTamer: ${label} — rate limited, waiting ${waitSeconds}s (attempt ${attempt})`);
        await sleep(waitSeconds * 1000);
        continue;
      }

      // Auth errors — don't retry, they won't resolve on their own
      if (response.status === 401 || response.status === 403) {
        console.error(`TabTamer: ${label} — auth error ${response.status}, not retrying`);
        return null;
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

async function getGroupColor(name) {
  // T8.11: Check for custom color override first
  if (_customGroupColors === null) {
    await loadCustomGroupColors();
  }
  if (_customGroupColors && _customGroupColors[name]) {
    return _customGroupColors[name];
  }
  // djb2 hash for deterministic color selection
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) + name.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

// T8.11: Load custom group colors from storage
async function loadCustomGroupColors() {
  try {
    const result = await browser.storage.local.get(GROUP_COLORS_KEY);
    _customGroupColors = result[GROUP_COLORS_KEY] || {};
  } catch (err) {
    console.warn('TabTamer: loadCustomGroupColors — storage read failed', err);
    _customGroupColors = {};
  }
}

// T10.8: Load dismissed rule suggestions from storage
async function loadDismissedSuggestions() {
  try {
    const result = await browser.storage.local.get(DISMISSED_RULE_SUGGESTIONS_KEY);
    _dismissedRuleSuggestions = result[DISMISSED_RULE_SUGGESTIONS_KEY] || {};
    // Prune entries older than 30 days
    _pruneDismissedSuggestions(true);
  } catch (err) {
    console.warn('TabTamer: loadDismissedSuggestions — storage read failed', err);
    _dismissedRuleSuggestions = {};
  }
}

// T10.8: Prune dismissed rule suggestion entries older than 30 days
// If persist is true, saves the pruned map to storage
async function _pruneDismissedSuggestions(persist) {
  const now = Date.now();
  let changed = false;
  for (const [domain, timestamp] of Object.entries(_dismissedRuleSuggestions)) {
    if (now - timestamp > RULE_SUGGESTION_PRUNE_AGE_MS) {
      delete _dismissedRuleSuggestions[domain];
      changed = true;
    }
  }
  if (changed && persist) {
    try {
      await browser.storage.local.set({ [DISMISSED_RULE_SUGGESTIONS_KEY]: _dismissedRuleSuggestions });
    } catch (err) {
      console.warn('TabTamer: _pruneDismissedSuggestions — storage write failed', err);
    }
  }
}

// T9.3: Load excluded domains from storage into in-memory lookup structures
async function loadExcludedDomains() {
  try {
    const result = await browser.storage.local.get(EXCLUDED_DOMAINS_KEY);
    const excluded = result[EXCLUDED_DOMAINS_KEY] || [];
    _exactExcludedDomains = new Set();
    _wildcardExcludedDomains = [];
    for (const pattern of excluded) {
      if (pattern.startsWith('*.')) {
        _wildcardExcludedDomains.push(pattern.slice(1)); // store suffix (e.g. '.domain.com')
      } else {
        _exactExcludedDomains.add(pattern);
      }
    }
  } catch (err) {
    console.warn('TabTamer: loadExcludedDomains — storage read failed', err);
    _exactExcludedDomains = new Set();
    _wildcardExcludedDomains = [];
  }
}

// ─── Tab Hibernation — Access Time Tracking (T9.19) ───────────────────────────

async function loadAccessTimes() {
  try {
    const result = await browser.storage.local.get(TABTAMER_LAST_ACCESS_KEY);
    _lastAccessTimes = result[TABTAMER_LAST_ACCESS_KEY] || {};
  } catch (err) {
    console.warn('TabTamer: loadAccessTimes — storage read failed', err);
    _lastAccessTimes = {};
  }
}

function persistAccessTimes() {
  if (_lastAccessStorageTimer) return;
  _lastAccessStorageTimer = setTimeout(async () => {
    _lastAccessStorageTimer = null;
    try {
      await browser.storage.local.set({ [TABTAMER_LAST_ACCESS_KEY]: _lastAccessTimes });
    } catch (err) {
      console.warn('TabTamer: persistAccessTimes — storage write failed', err);
    }
  }, STORAGE_THROTTLE_MS);
}

// T10.4: Flush access times to storage immediately (for shutdown/suspend)
async function flushAccessTimes() {
  if (_lastAccessStorageTimer) {
    clearTimeout(_lastAccessStorageTimer);
    _lastAccessStorageTimer = null;
  }
  try {
    await browser.storage.local.set({ [TABTAMER_LAST_ACCESS_KEY]: _lastAccessTimes });
    console.log('TabTamer: flushed _lastAccessTimes to storage');
  } catch (err) {
    console.warn('TabTamer: flushAccessTimes — storage write failed', err);
  }
}

function updateLastAccess(tabId) {
  _lastAccessTimes[tabId] = Date.now();
  persistAccessTimes();
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

// T11.9: Pre-LLM classification check — runs rules and cache matching only.
// Returns { matched: true } if the tab was assigned via rule or cache.
// Returns { matched: false, domain } if LLM classification is needed.
async function _classifyTabPreLLM(tabId, url, title) {
  // Check if extension is enabled
  if (!(await isEnabled())) return { matched: true };

  // Skip tabs in manually-managed groups
  try {
    const tabInfo = await browser.tabs.get(tabId);
    if (tabInfo.groupId > 0 && _managedGroupIds !== null && !_managedGroupIds.has(tabInfo.groupId)) {
      console.log(`TabTamer: tab ${tabId} in manually-managed group — skipping`);
      return { matched: true };
    }
  } catch (tabErr) {
    if (tabErr.message && tabErr.message.includes('Invalid tab ID')) {
      return { matched: true };
    }
  }

  // Extract domain
  const domain = extractDomain(url);
  if (!domain) return { matched: true };

  // Skip excluded domains
  if (await isDomainExcluded(domain)) {
    console.log(`TabTamer: domain excluded — ${domain}, skipping classification`);
    return { matched: true };
  }

  // Check rules — first match wins
  const ruleGroup = await TabTamerRules.matchRules(domain);
  if (ruleGroup) {
    console.log(`TabTamer: startup pre-LLM rule match — "${ruleGroup}" for ${domain}`);
    try {
      await assignToGroup(tabId, ruleGroup);
    } catch (err) {
      if (err.message && err.message.includes('Invalid tab ID')) return { matched: true };
      throw err;
    }
    _addRecentClassification({
      domain,
      group: ruleGroup,
      timestamp: Date.now()
    });
    return { matched: true };
  }

  // Check cache
  const cachedGroup = await getCachedGroup(domain);
  if (cachedGroup) {
    console.log(`TabTamer: startup pre-LLM cache hit — "${cachedGroup}" for ${domain}`);

    // Skip if tab is already in a group with the cached name
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.groupId && tab.groupId > 0) {
        const groups = await browser.tabGroups.query({ id: tab.groupId });
        if (groups.length > 0 && groups[0].title === cachedGroup) {
          console.log(`TabTamer: tab ${tabId} already in group "${cachedGroup}" — skipping`);
          return { matched: true };
        }
      }
    } catch (err) {
      if (err.message && err.message.includes('Invalid tab ID')) {
        return { matched: true };
      }
    }

    try {
      await assignToGroup(tabId, cachedGroup);
    } catch (err) {
      if (err.message && err.message.includes('Invalid tab ID')) return { matched: true };
      throw err;
    }
    _addRecentClassification({
      domain,
      group: cachedGroup,
      timestamp: Date.now()
    });
    return { matched: true };
  }

  // Neither rule nor cache matched — needs LLM
  return { matched: false, domain };
}

// T11.9: Batch classify all ungrouped tabs in a single LLM call for
// coherent, cost-efficient grouping during startup scan.
async function batchClassifyTabs(tabEntries) {
  // tabEntries = [{ tabId, url, title, domain }, ...]
  if (!tabEntries || tabEntries.length === 0) return;

  try {
    // Check API key
    const settings = await getSettings();
    const apiKey = settings.apiKey;

    if (!apiKey) {
      console.warn('TabTamer: batch classify — API key not set, falling back to individual');
      for (const entry of tabEntries) {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      }
      return;
    }

    const model = resolveModel(settings);
    const endpoint = resolveEndpoint(settings);

    if (!endpoint || !model) {
      console.warn('TabTamer: batch classify — no endpoint/model, falling back to individual');
      for (const entry of tabEntries) {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      }
      return;
    }

    // Gather existing groups for the prompt (prefer reuse)
    const existingGroups = await browser.tabGroups.query({});
    const allTabs = await browser.tabs.query({});
    const tabCountByGroupId = {};
    for (const tab of allTabs) {
      if (tab.groupId > 0) {
        tabCountByGroupId[tab.groupId] = (tabCountByGroupId[tab.groupId] || 0) + 1;
      }
    }

    const groupsWithTitles = existingGroups.filter(g => g.title);
    groupsWithTitles.sort((a, b) => (tabCountByGroupId[b.id] || 0) - (tabCountByGroupId[a.id] || 0));

    let promptGroupList = '';
    if (groupsWithTitles.length > 0) {
      const topGroups = groupsWithTitles.slice(0, MAX_GROUP_NAMES_IN_PROMPT);
      promptGroupList = topGroups.map(g => g.title).join(', ');
      if (groupsWithTitles.length > MAX_GROUP_NAMES_IN_PROMPT) {
        const remaining = groupsWithTitles.length - MAX_GROUP_NAMES_IN_PROMPT;
        promptGroupList += `, ...and ${remaining} more`;
      }
    }

    // Build the batch prompt with all tab URLs and titles
    const tabsListStr = tabEntries.map((t, i) =>
      `[${i}] URL: ${t.url}\nTitle: ${t.title || '(no title)'}`
    ).join('\n\n');

    const systemPrompt = 'You are a tab grouping assistant. Given a list of tabs with URLs and titles, '
      + 'group them into 3-7 coherent groups. Prefer reusing existing groups if applicable. '
      + (promptGroupList ? `Existing groups: [${promptGroupList}]. ` : '')
      + 'Return JSON only: {"groups": [{"name": "Group Name", "tabIndices": [0, 3, 7]}, ...]}';

    const userMessage = `List of tabs to group:\n\n${tabsListStr}`;

    console.log(`TabTamer: batch classify — sending ${tabEntries.length} tabs in single LLM call`);

    const response = await retryWithBackoff(() => fetch(endpoint, {
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
        max_tokens: 500,
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    }), { label: 'batch classification', maxRetries: 3 });

    if (!response) {
      console.warn('TabTamer: batch classify — LLM call failed after retries, falling back to individual');
      for (const entry of tabEntries) {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      }
      return;
    }

    const data = await response.json();
    const usageActual = data.usage?.total_tokens;
    const content = data.choices?.[0]?.message?.content?.trim();

    // Track cost estimate
    const estimatedTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
    await updateCosts(estimatedTokens, usageActual);

    if (!content) {
      console.warn('TabTamer: batch classify — empty response, falling back to individual');
      for (const entry of tabEntries) {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      }
      return;
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch (parseErr) {
      console.error('TabTamer: batch classify — invalid JSON parse, falling back to individual', parseErr);
      for (const entry of tabEntries) {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      }
      return;
    }

    if (!result || !Array.isArray(result.groups)) {
      console.warn('TabTamer: batch classify — response missing groups array, falling back to individual');
      for (const entry of tabEntries) {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      }
      return;
    }

    // Assign tabs to groups based on the LLM response
    const assigned = new Set();
    for (const group of result.groups) {
      if (!group.name || !Array.isArray(group.tabIndices)) continue;
      const normalizedName = normalizeGroupName(group.name);
      if (!normalizedName) continue;

      for (const idx of group.tabIndices) {
        if (typeof idx !== 'number' || idx < 0 || idx >= tabEntries.length || assigned.has(idx)) continue;
        assigned.add(idx);
        try {
          await assignToGroup(tabEntries[idx].tabId, normalizedName);
          await setCachedGroup(tabEntries[idx].domain, normalizedName);
          _addRecentClassification({
            domain: tabEntries[idx].domain,
            group: normalizedName,
            timestamp: Date.now()
          });
          // Show rule suggestion for this domain
          _showRuleSuggestion(tabEntries[idx].domain, normalizedName).catch(() => {});
        } catch (err) {
          console.error(`TabTamer: batch classify — assign error for tab ${tabEntries[idx].tabId}`, err);
        }
      }
    }

    // Fallback: classify any unassigned tabs individually
    for (let i = 0; i < tabEntries.length; i++) {
      if (!assigned.has(i)) {
        console.log(`TabTamer: batch classify — tab ${i} (${tabEntries[i].domain}) not assigned, classifying individually`);
        await classifyAndAssign(tabEntries[i].tabId, tabEntries[i].url, tabEntries[i].title, tabEntries[i].domain);
      }
    }

    console.log(`TabTamer: batch classify — complete, ${assigned.size}/${tabEntries.length} tabs assigned in batch`);
  } catch (err) {
    console.error('TabTamer: batch classify error, falling back to individual', err);
    for (const entry of tabEntries) {
      try {
        await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
      } catch (innerErr) {
        console.error(`TabTamer: batch classify fallback error for tab ${entry.tabId}`, innerErr);
      }
    }
  }
}

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

    // T10.12: Track progress for badge and popup display
    const totalCount = ungroupedTabs.length;
    let processedCount = 0;
    _startupProgress = { processed: 0, total: totalCount };

    // T11.9: Check if batch clustering is enabled (default: true)
    const settings = await getSettings();
    const batchEnabled = settings.batchClusteringEnabled !== false;

    // Phase 1: Process all tabs through rules and cache (no LLM)
    // Collect tabs that need LLM classification for batch processing
    const tabsNeedingLLM = [];

    const preLLMPromises = ungroupedTabs.map(tab =>
      runWithConcurrencyLimit(async () => {
        const result = await _classifyTabPreLLM(tab.id, tab.url, tab.title);
        if (!result.matched && result.domain) {
          tabsNeedingLLM.push({ tabId: tab.id, url: tab.url, title: tab.title, domain: result.domain });
        }
        processedCount++;
        _startupProgress = { processed: processedCount, total: totalCount };

        // Update badge with progress: "3/42"
        browser.browserAction.setBadgeText({ text: `${processedCount}/${totalCount}` });
        browser.browserAction.setBadgeBackgroundColor({ color: '#34c759' });

        // T10.12: Send progress message to popup (fire-and-forget, popup may not be open)
        browser.runtime.sendMessage({
          type: 'startupProgress',
          processed: processedCount,
          total: totalCount
        }).catch(() => {});
      })
    );
    await Promise.all(preLLMPromises);

    // Phase 2: Classify tabs that need LLM — batch or individual
    if (tabsNeedingLLM.length > 0) {
      console.log(`TabTamer: startup scan — ${tabsNeedingLLM.length} tabs need LLM classification`);

      if (batchEnabled) {
        await batchClassifyTabs(tabsNeedingLLM);
      } else {
        // Fallback to individual classification (existing behavior)
        const individualPromises = tabsNeedingLLM.map(entry =>
          runWithConcurrencyLimit(async () => {
            _pendingClassificationCount++;
            updateBadge(true);
            try {
              await classifyAndAssign(entry.tabId, entry.url, entry.title, entry.domain);
            } finally {
              _pendingClassificationCount = Math.max(0, _pendingClassificationCount - 1);
              updateBadge(_pendingClassificationCount > 0);
            }
          })
        );
        await Promise.all(individualPromises);
      }
    }

    console.log(`TabTamer: startup scan complete — ${totalCount} tabs processed`);
  } catch (err) {
    console.error('TabTamer: startup scan error', err);
  } finally {
    // Clear startup progress tracking
    _startupProgress = null;

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
  // T9.19: Track tab navigation as user activity for hibernation
  if (changeInfo.url && tab.url) {
    updateLastAccess(tabId);

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
  // T9.19: Clean up last access tracking when tab is closed
  delete _lastAccessTimes[tabId];
});

// T9.19: Track tab activation for hibernation idle detection
browser.tabs.onActivated.addListener((activeInfo) => {
  updateLastAccess(activeInfo.tabId);
});

// T3.4: Handle SPA navigations from content script
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'spaNavigate' && sender.tab && sender.tab.id && sender.tab.url) {
    const tabId = sender.tab.id;
    console.log(`TabTamer: SPA navigation in tab ${tabId} — ${sender.tab.url}`);
    runWithConcurrencyLimit(() => handleTab(tabId, sender.tab.url, sender.tab.title));
  }

  // T8.9: Classify-this-tab button in popup
  if (message.type === 'classifyNow' && message.tabId) {
    runWithConcurrencyLimit(() => handleTab(message.tabId, message.url, message.title));
  }

  // T10.9: LLM-assisted rule creation — batch cache scanning
  if (message.type === 'suggestRules') {
    return suggestRulesFromCache();
  }

  // T7.10: Popup state queries
  if (message.type === 'getPopupState') {
    return getPopupState();
  }

  // T10.9: Handle suggest rules result approval from options page
  if (message.type === 'approveSuggestedRule') {
    return handleApproveSuggestedRule(message.rule);
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
    let managedGroupTabCounts = {};
    try {
      const groups = await browser.tabGroups.query({});
      const managedGroups = groups.filter(g => _managedGroupIds && _managedGroupIds.has(g.id));
      groupNames = managedGroups.map(g => g.title).filter(Boolean);

      // T9.13: Count tabs per group for popup display (single query + JS counting)
      const allTabs = await browser.tabs.query({});
      const tabCountByGroupId = {};
      for (const tab of allTabs) {
        if (tab.groupId > 0) {
          tabCountByGroupId[tab.groupId] = (tabCountByGroupId[tab.groupId] || 0) + 1;
        }
      }
      for (const g of managedGroups) {
        if (g.title) {
          managedGroupTabCounts[g.title] = (managedGroupTabCounts[g.title] || 0) + (tabCountByGroupId[g.id] || 0);
        }
      }
    } catch (err) {
      console.warn('TabTamer: getPopupState — error querying groups', err.message);
    }

    // T9.14: Read cost tracking data for popup display
    let totalCost = 0;
    let totalCalls = 0;
    let totalEstimatedTokens = 0;
    let totalLiveTokens = 0;
    try {
      const costResult = await browser.storage.local.get(COSTS_KEY);
      const costs = costResult[COSTS_KEY] || {};
      totalCost = costs.totalCost || 0;
      totalCalls = costs.calls || 0;
      totalEstimatedTokens = costs.estimatedTokens || 0;
      totalLiveTokens = costs.liveTokens || 0;
    } catch (err) {
      console.warn('TabTamer: getPopupState — error reading costs', err.message);
    }

    return {
      enabled,
      managedGroupCount: groupNames.length,
      managedGroupNames: groupNames,
      managedGroupTabCounts,
      recentClassifications: _recentClassifications,
      processingCount: _pendingClassificationCount,
      hibernatedCount: _hibernatedCount,
      totalCost,
      totalCalls,
      totalEstimatedTokens,
      totalLiveTokens,
      startupProgress: _startupProgress
    };
  } catch (err) {
    console.error('TabTamer: getPopupState error', err);
    return {
      enabled: false,
      managedGroupCount: 0,
      managedGroupNames: [],
      managedGroupTabCounts: {},
      recentClassifications: [],
      processingCount: 0,
      hibernatedCount: 0,
      totalCost: 0,
      totalCalls: 0,
      totalEstimatedTokens: 0,
      totalLiveTokens: 0,
      startupProgress: null
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
          const ptext = `${managedCount}…`;
          browser.browserAction.setBadgeText({ text: _hibernationBadgeActive ? `💤${ptext}` : ptext });
        } else {
          const ntext = managedCount > 0 ? String(managedCount) : '';
          browser.browserAction.setBadgeText({ text: _hibernationBadgeActive ? `💤${ntext}` : ntext });
        }
        browser.browserAction.setBadgeBackgroundColor({ color: '#34c759' });
      }
    } catch (err) {
      console.error('TabTamer: updateBadge error', err);
    }
  }, 500);
}

// ─── Toolbar Icon Theme (T10.17) ───────────────────────────────────────────

// T10.17: Update toolbar icon based on theme setting (light/dark/system)
async function _updateToolbarIcon() {
  try {
    const settings = await getSettings();
    const theme = settings.theme || 'system';

    let useDark = false;
    if (theme === 'dark') {
      useDark = true;
    } else if (theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia) {
        useDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    }

    await browser.browserAction.setIcon({
      path: useDark ? 'icons/icon-48-dark.png' : 'icons/icon-48.png'
    });
  } catch (err) {
    console.warn('TabTamer: failed to update toolbar icon', err);
  }
}

// T10.17: Listen for system theme changes and update icon accordingly
function _setupAutoThemeListener() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const darkModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      darkModeMedia.addListener(() => _updateToolbarIcon());
    }
  } catch (err) {
    console.warn('TabTamer: failed to set up auto theme listener', err);
  }
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
      // T10.25: Show brief notification toast when toggled via keyboard
      browser.notifications.create('tabtamer-toggle', {
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'TabTamer',
        message: `TabTamer: ${settings.enabled ? 'ON' : 'OFF'}`
      }).catch(() => {});
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
      // T8.4: Track this classification for the popup
      _addRecentClassification({
        domain,
        group: ruleGroup,
        timestamp: Date.now()
      });
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
      // T8.4: Track this classification for the popup
      _addRecentClassification({
        domain,
        group: cachedGroup,
        timestamp: Date.now()
      });
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
    // T9.3: O(1) Set lookup for exact matches, O(n) for wildcard patterns
    if (_exactExcludedDomains.has(domain)) {
      return true;
    }
    for (const suffix of _wildcardExcludedDomains) {
      // Wildcard match: '.domain.com' matches sub.domain.com, foo.bar.domain.com, etc.
      if (domain.endsWith(suffix)) {
        return true;
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

// T10.15: Cache helpers moved to lib/utils.js — _getCacheGroupName, _getCacheTimestamp

// T10.15: Helper: create a cache entry value with timestamp
function _makeCacheEntry(groupName) {
  return { group: groupName, timestamp: Date.now() };
}

// T10.15: Migrate old-format cache entries (string values) to new format (object with timestamp)
async function migrateCacheFormat() {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    let changed = false;
    for (const [domain, value] of Object.entries(cache)) {
      if (typeof value === 'string') {
        cache[domain] = _makeCacheEntry(value);
        changed = true;
      }
    }
    if (changed) {
      await browser.storage.local.set({ [CACHE_KEY]: cache });
      console.log('TabTamer: migrated cache to new format with timestamps');
    }
  } catch (err) {
    console.warn('TabTamer: cache migration failed', err);
  }
}

async function getCachedGroup(domain) {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    const entry = cache[domain];
    return entry ? _getCacheGroupName(entry) : null;
  } catch (err) {
    console.error('TabTamer: cache read error', err);
    return null;
  }
}

async function setCachedGroup(domain, groupName) {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    cache[domain] = _makeCacheEntry(groupName);
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

    // T10.17: Update toolbar icon when theme setting changes
    _updateToolbarIcon();
  }

  // T8.11: Refresh custom group colors when changed from options page
  if (areaName === 'local' && changes[GROUP_COLORS_KEY]) {
    _customGroupColors = changes[GROUP_COLORS_KEY].newValue || {};
    console.log('TabTamer: custom group colors updated from storage change');
  }

  // T9.3: Refresh excluded domain lookup structures when user changes them
  if (areaName === 'local' && changes[EXCLUDED_DOMAINS_KEY]) {
    const excluded = changes[EXCLUDED_DOMAINS_KEY].newValue || [];
    _exactExcludedDomains = new Set();
    _wildcardExcludedDomains = [];
    for (const pattern of excluded) {
      if (pattern.startsWith('*.')) {
        _wildcardExcludedDomains.push(pattern.slice(1));
      } else {
        _exactExcludedDomains.add(pattern);
      }
    }
    console.log('TabTamer: excluded domains updated from storage change');
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
      const groupColor = await getGroupColor(groupName);
      const newGroup = await browser.tabGroups.create({
        title: groupName,
        windowId: tab.windowId,
        color: groupColor
      });
      groupId = newGroup.id;
      console.log(`TabTamer: created new group "${groupName}" (id: ${groupId}, color: ${groupColor})`);
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

    // Read model and endpoint from settings
    const model = resolveModel(settings);
    const endpoint = resolveEndpoint(settings);

    if (!endpoint) {
      console.warn('TabTamer: no API endpoint configured — leaving tab ungrouped');
      return;
    }

    if (!model) {
      console.warn('TabTamer: no model configured — leaving tab ungrouped');
      return;
    }

    // System prompt: classify into 1-3 word group name, Title Case
    // T4.6: Include existing group names to reduce proliferation
    // T9.5: Cap group names at MAX_GROUP_NAMES_IN_PROMPT, prioritize groups with most tabs
    const allGroups = await browser.tabGroups.query({});

    // Query all tabs once and count by groupId to sort groups by popularity
    const allTabs = await browser.tabs.query({});
    const tabCountByGroupId = {};
    for (const tab of allTabs) {
      if (tab.groupId > 0) {
        tabCountByGroupId[tab.groupId] = (tabCountByGroupId[tab.groupId] || 0) + 1;
      }
    }

    // Sort groups by tab count descending, cap at MAX_GROUP_NAMES_IN_PROMPT
    const groupsWithTitles = allGroups.filter(g => g.title);
    groupsWithTitles.sort((a, b) => (tabCountByGroupId[b.id] || 0) - (tabCountByGroupId[a.id] || 0));

    let promptGroupList = '';
    if (groupsWithTitles.length > 0) {
      const topGroups = groupsWithTitles.slice(0, MAX_GROUP_NAMES_IN_PROMPT);
      promptGroupList = topGroups.map(g => g.title).join(', ');
      if (groupsWithTitles.length > MAX_GROUP_NAMES_IN_PROMPT) {
        const remaining = groupsWithTitles.length - MAX_GROUP_NAMES_IN_PROMPT;
        promptGroupList += `, ...and ${remaining} more`;
      }
    }

    const systemPrompt = promptGroupList
      ? `Classify the following tab URL into a short group name (1-3 words, Title Case). Prefer reusing an existing group if applicable. Existing groups: [${promptGroupList}]. Only create a new name if none fit. Return ONLY the group name.`
      : 'Classify the following tab URL into a short group name (1-3 words, Title Case). Respond with only the group name.';
    const userMessage = `URL: ${url}\nTitle: ${title || '(no title)'}`;

    console.log(`TabTamer: calling LLM for ${domain} (model: ${model}, endpoint: ${endpoint})`);

    // T5.5: Use unified retry-with-backoff instead of inline duplicate
    const response = await retryWithBackoff(() => fetch(endpoint, {
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
        max_tokens: CLASSIFY_MAX_TOKENS,
        temperature: 0
      })
    }), { label: `classification for ${domain}` });

    if (!response) {
      // T9.16: Notify user on silent LLM classification failure
      await notifyClassifyFailure(domain);
      return; // All retries exhausted — leave tab ungrouped
    }

    const data = await response.json();
    const usageActual = data.usage?.total_tokens;
    const groupName = data.choices?.[0]?.message?.content?.trim();

    // Compute dynamic token estimate from prompt length
    const estimatedTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);

    if (!groupName) {
      console.warn(`TabTamer: empty LLM response for ${domain}`);
      // T7.2: Still track cost — tokens were consumed by the API call
      await updateCosts(estimatedTokens, usageActual);
      return; // Leave tab ungrouped
    }

    // T4.8: Normalize group name before caching/assigning
    const normalizedName = normalizeGroupName(groupName);
    console.log(`TabTamer: classified ${domain} → "${normalizedName}"`);

    // Track cost only for successful classifications (not retries)
    await updateCosts(estimatedTokens, usageActual);
    await setCachedGroup(domain, normalizedName);
    await assignToGroup(tabId, normalizedName);

    // T10.8: Suggest saving this domain→group mapping as a permanent rule
    _showRuleSuggestion(domain, normalizedName).catch(err =>
      console.warn('TabTamer: _showRuleSuggestion failed', err)
    );

    // T7.10: Track this classification for the popup
    _addRecentClassification({
      domain,
      group: normalizedName,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error(`TabTamer: classification error for ${domain}`, err);
    // Leave tab ungrouped on error
  }
}

// ─── T10.9: LLM-Assisted Rule Creation — Batch Cache Scanning ────────────────

async function suggestRulesFromCache() {
  try {
    // Read cache entries from storage
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    // T10.15: Normalize entries (support both old string and new object format)
    const entries = Object.entries(cache).map(([domain, value]) => [domain, _getCacheGroupName(value)]);

    if (entries.length === 0) {
      return { success: false, error: 'Cache is empty — no domains to analyze.' };
    }

    // Check API key
    const settings = await getSettings();
    const apiKey = settings.apiKey;
    if (!apiKey) {
      return { success: false, error: 'API key not set. Please configure your API key first.' };
    }

    const model = resolveModel(settings);
    const endpoint = resolveEndpoint(settings);

    if (!endpoint) {
      return { success: false, error: 'No API endpoint configured. Please check your provider settings.' };
    }

    if (!model) {
      return { success: false, error: 'No model configured. Please check your provider settings.' };
    }

    // Sample up to 50 entries (prioritize diverse groups)
    const sampled = _sampleCacheEntries(entries, 50);

    // Build the prompt
    const mappingsStr = sampled
      .map(([domain, group]) => `- ${domain} → ${group}`)
      .join('\n');

    const systemPrompt = 'You are a TabTamer extension analyzing domain→group mappings. '
      + 'Suggest rules that map domain patterns to groups.\n\n'
      + 'Rules support * (matches any sequence) and ? (matches any single character) glob patterns. '
      + 'Patterns match the full domain (anchored).\n\n'
      + 'Return a JSON array of objects with ONLY these fields:\n'
      + '- "pattern": string — glob pattern for domain matching\n'
      + '- "groupName": string — the group to map to (must match existing group names exactly)\n'
      + '- "confidence": number — 0 to 1, how confident you are in this suggestion\n'
      + '- "reason": string — brief explanation of the pattern\n\n'
      + 'Only suggest rules where you see a clear pattern. '
      + 'Return [] if no clear patterns emerge. '
      + 'IMPORTANT: Do not create new groups — only map to groups already present in the data.';

    const userMessage = 'Here are the current domain→group mappings:\n\n' + mappingsStr;

    console.log('TabTamer: suggesting rules from cache — sending LLM request');

    const response = await retryWithBackoff(() => fetch(endpoint, {
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
        max_tokens: 1000,
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    }), { label: 'rule suggestion', maxRetries: 3 });

    if (!response) {
      return { success: false, error: 'LLM request failed after retries. Check your API key and connection.' };
    }

    const data = await response.json();
    const usageActual = data.usage?.total_tokens;
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      // Still track cost — tokens were consumed
      const estimatedTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
      await updateCosts(estimatedTokens, usageActual);
      return { success: false, error: 'Empty response from LLM.' };
    }

    let suggestions;
    try {
      suggestions = JSON.parse(content);
    } catch (parseErr) {
      console.error('TabTamer: suggest rules — invalid JSON response', parseErr, content);
      return { success: false, error: 'LLM returned invalid JSON. Please try again.' };
    }

    if (!Array.isArray(suggestions)) {
      return { success: false, error: 'LLM returned unexpected format. Expected an array.' };
    }

    // Validate and sanitize suggestions
    const validSuggestions = suggestions
      .filter(s => s && s.pattern && s.groupName)
      .map(s => ({
        pattern: s.pattern.trim(),
        groupName: s.groupName.trim(),
        confidence: typeof s.confidence === 'number' ? Math.min(1, Math.max(0, s.confidence)) : 0.5,
        reason: s.reason || ''
      }));

    // Track cost (estimated tokens for the prompt length + actual from response)
    const estimatedTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
    await updateCosts(estimatedTokens, usageActual);

    console.log(`TabTamer: suggest rules — got ${validSuggestions.length} valid suggestions`);

    return { success: true, suggestions: validSuggestions };
  } catch (err) {
    console.error('TabTamer: suggest rules error', err);
    return { success: false, error: err.message || 'Unknown error occurred.' };
  }
}

// Sample cache entries prioritizing diverse groups (max N entries)
function _sampleCacheEntries(entries, maxCount) {
  if (entries.length <= maxCount) return entries;

  // Group entries by group name
  const byGroup = {};
  for (const [domain, group] of entries) {
    if (!byGroup[group]) byGroup[group] = [];
    byGroup[group].push([domain, group]);
  }

  // Sample from each group round-robin to get diverse coverage
  const groupNames = Object.keys(byGroup);
  const sampled = [];
  let idx = 0;
  let anyLeft = true;

  while (sampled.length < maxCount && anyLeft) {
    anyLeft = false;
    for (const name of groupNames) {
      if (byGroup[name].length > 0) {
        sampled.push(byGroup[name].shift());
        anyLeft = true;
        if (sampled.length >= maxCount) break;
      }
    }
  }

  return sampled;
}

// T10.9: Handle approving a suggested rule
async function handleApproveSuggestedRule(rule) {
  try {
    if (!rule || !rule.pattern || !rule.groupName) {
      return { success: false, error: 'Invalid rule data.' };
    }

    // Validate pattern before adding
    if (!TabTamerRules.isValidPattern(rule.pattern)) {
      return { success: false, error: `Invalid pattern: "${rule.pattern}"` };
    }

    if (!TabTamerRules.isValidGroupName(rule.groupName)) {
      return { success: false, error: `Invalid group name: "${rule.groupName}"` };
    }

    await TabTamerRules.addRule(rule.pattern, rule.groupName, true);
    console.log(`TabTamer: approved suggested rule — "${rule.pattern}" → "${rule.groupName}"`);
    return { success: true };
  } catch (err) {
    console.error('TabTamer: approve suggested rule error', err);
    return { success: false, error: err.message || 'Failed to add rule.' };
  }
}

// ─── Missing API Key Notification ────────────────────────────────────────────
// TAS-9: Notify the user once when API key is not set

async function notifyMissingApiKey() {
  try {
    const result = await browser.storage.local.get(NO_API_KEY_NOTIFIED_KEY);
    if (result[NO_API_KEY_NOTIFIED_KEY]) {
      return; // Already notified once
    }

    await browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'TabTamer',
      message: 'Set your API key in TabTamer options to enable auto-grouping.'
    });

    await browser.storage.local.set({ [NO_API_KEY_NOTIFIED_KEY]: true });
    console.log('TabTamer: notified user about missing API key');
  } catch (err) {
    console.error('TabTamer: notifyMissingApiKey error', err);
  }
}

// ─── T10.8: Rule Suggestion Notification ─────────────────────────────────────
// After a successful LLM classification, suggest saving the domain→group mapping
// as a permanent rule. Clicking the notification approves the rule.

async function _showRuleSuggestion(domain, groupName) {
  try {
    // Skip if we've already suggested a rule for this domain in this session
    if (_suggestedDomains.has(domain)) {
      return;
    }

    // Skip if there's already a rule matching this domain
    const existingRule = await TabTamerRules.matchRules(domain);
    if (existingRule) {
      _suggestedDomains.add(domain);
      return; // Rule already exists for this domain
    }

    // Skip if the user dismissed a suggestion for this domain within 30 days
    const dismissedTimestamp = _dismissedRuleSuggestions[domain];
    if (dismissedTimestamp && (Date.now() - dismissedTimestamp < RULE_SUGGESTION_COOLDOWN_MS)) {
      _suggestedDomains.add(domain); // Also track per-session to avoid re-checking
      return;
    }

    // Mark as suggested for this session
    _suggestedDomains.add(domain);

    // Create a notification with an encoded ID for the onClicked handler
    // Use a simple ID pattern for tracking
    const notificationId = `tabtamer-rule-suggest-${domain}`;

    // Store the suggestion data for the onClicked handler
    _pendingSuggestionNotificationIds.set(notificationId, {
      domain,
      groupName,
      timestamp: Date.now()
    });

    await browser.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'TabTamer',
      message: `Save "${domain}" → ${groupName} as a rule? Click to approve.`
    });

    console.log(`TabTamer: showed rule suggestion for ${domain} → ${groupName}`);

    // Auto-clean up notification tracking after 30 seconds
    // (notifications auto-dismiss, but we clean up our map)
    setTimeout(() => {
      if (_pendingSuggestionNotificationIds.has(notificationId)) {
        // User didn't click — treat as dismissed
        _dismissedRuleSuggestions[domain] = Date.now();
        _pendingSuggestionNotificationIds.delete(notificationId);
        // Persist dismissed suggestion
        browser.storage.local.set({ [DISMISSED_RULE_SUGGESTIONS_KEY]: _dismissedRuleSuggestions })
          .catch(err => console.warn('TabTamer: persist dismissed suggestion failed', err));
        console.log(`TabTamer: rule suggestion for ${domain} timed out — marked as dismissed`);
      }
    }, 30000);
  } catch (err) {
    console.error('TabTamer: _showRuleSuggestion error', err);
  }
}

// T10.8: Testability accessor — returns true if domain was already suggested this session
function _isDomainSuggested(domain) {
  return _suggestedDomains.has(domain);
}

// T10.8: Testability accessor — returns the dismissed rule suggestions map
function _getDismissedSuggestions() {
  return _dismissedRuleSuggestions;
}

// T10.8: Testability accessor — returns true if a suggestion notification is pending for this domain
function _hasPendingSuggestion(domain) {
  return _pendingSuggestionNotificationIds.has(`tabtamer-rule-suggest-${domain}`);
}

// T10.8: Reset suggestion state (for testing)
function _resetSuggestionState() {
  _suggestedDomains = new Set();
  _dismissedRuleSuggestions = {};
  _pendingSuggestionNotificationIds = new Map();
}

// T10.8: Handle notification clicks for rule suggestion approval
async function _handleRuleSuggestionClick(notificationId) {
  if (!notificationId.startsWith('tabtamer-rule-suggest-')) {
    return; // Not one of our rule suggestion notifications
  }

  const suggestion = _pendingSuggestionNotificationIds.get(notificationId);
  if (!suggestion) {
    console.log('TabTamer: rule suggestion notification clicked but no pending data found');
    return;
  }

  // Extract domain from notification ID
  const domain = notificationId.replace('tabtamer-rule-suggest-', '');
  console.log(`TabTamer: user approved rule suggestion for ${domain} → ${suggestion.groupName}`);

  try {
    // Add the rule
    await TabTamerRules.addRule(domain, suggestion.groupName, true);
    console.log(`TabTamer: rule created from suggestion — "${domain}" → "${suggestion.groupName}"`);

    // Clean up tracking
    _pendingSuggestionNotificationIds.delete(notificationId);
    // Remove from dismissed if it was there (shouldn't be, but just in case)
    delete _dismissedRuleSuggestions[domain];
  } catch (err) {
    console.error('TabTamer: failed to create rule from suggestion', err);
  }
}

browser.notifications.onClicked.addListener(_handleRuleSuggestionClick);

// ─── Classification Failure Notification (T9.16) ────────────────────────────
// T9.16: Notify user when retryWithBackoff exhausts all retries for a
// classification call. Throttled to once per CLASSIFY_FAILURE_COOLDOWN_MS.

async function notifyClassifyFailure(domain) {
  try {
    const now = Date.now();
    if (now - _lastClassifyFailureNotification < CLASSIFY_FAILURE_COOLDOWN_MS) {
      return; // Suppressed — too soon since last notification
    }
    _lastClassifyFailureNotification = now;

    await browser.notifications.create('tabtamer-classify-failure', {
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'TabTamer',
      message: `Could not classify tab — ${domain}. Check your API key and connection.`
    });
    console.log(`TabTamer: notified user about classification failure for ${domain}`);
  } catch (err) {
    console.error('TabTamer: notifyClassifyFailure error', err);
  }
}

// ─── Alarms ─────────────────────────────────────────────────────────────────
// Phase 2: Periodic cleanup & group merging

// T4.9: Helper to create all periodic alarms (used by onStartup and onInstalled)
function createAlarms() {
  browser.alarms.create('cleanup', { periodInMinutes: CLEANUP_INTERVAL_MIN });
  browser.alarms.create('merge', { periodInMinutes: MERGE_INTERVAL_MIN });
  browser.alarms.create('cost-log', { periodInMinutes: COST_LOG_INTERVAL_MIN });
  browser.alarms.create(HIBERNATE_ALARM_NAME, { periodInMinutes: HIBERNATE_INTERVAL_MIN });
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
  } else if (alarm.name === HIBERNATE_ALARM_NAME) {
    console.log('TabTamer: alarm fired — hibernation check');
    hibernateIdleTabs();
  }
});

// ─── Cost Tracking ──────────────────────────────────────────────────────
// Phase 2: Track cumulative API calls and estimated/live token usage

async function updateCosts(estimated, actual) {
  try {
    // Read user's configurable cost-per-million-tokens rate from settings
    let costPerMillion = 1.0; // default $1/M tokens
    try {
      const settingsResult = await browser.storage.local.get(SETTINGS_KEY);
      const settings = settingsResult[SETTINGS_KEY] || {};
      if (settings.costPerMillionTokens != null) {
        costPerMillion = parseFloat(settings.costPerMillionTokens) || 0;
      }
    } catch (settingsErr) {
      console.warn('TabTamer: could not read pricing settings, using default $1/M', settingsErr);
    }

    const costPerToken = costPerMillion / 1000000;

    const result = await browser.storage.local.get(COSTS_KEY);
    const costs = result[COSTS_KEY] || { calls: 0, estimatedTokens: 0, liveTokens: 0, totalCost: 0 };
    costs.calls += 1;
    costs.estimatedTokens += estimated;
    if (actual != null) {
      costs.liveTokens = (costs.liveTokens || 0) + actual;
    }
    // Use live tokens for cost if available, otherwise estimated
    const tokensForCost = actual != null ? actual : estimated;
    costs.totalCost = (costs.totalCost || 0) + tokensForCost * costPerToken;
    // Round to 6 decimal places to avoid floating-point artifacts
    costs.totalCost = Math.round(costs.totalCost * 1e6) / 1e6;
    await browser.storage.local.set({ [COSTS_KEY]: costs });
  } catch (err) {
    console.error('TabTamer: cost tracking error', err);
  }
}

async function logCostSummary() {
  try {
    const result = await browser.storage.local.get(COSTS_KEY);
    const costs = result[COSTS_KEY] || { calls: 0, estimatedTokens: 0, liveTokens: 0 };
    const livePart = costs.liveTokens ? `, ${costs.liveTokens} live tokens` : '';
    console.log(`TabTamer: cost summary — ${costs.calls} API calls, ~${costs.estimatedTokens} estimated tokens${livePart}`);
  } catch (err) {
    console.error('TabTamer: cost summary error', err);
  }
}

// ─── Tab Hibernation Engine (T9.19) ────────────────────────────────────────────

async function hibernateIdleTabs() {
  try {
    if (!(await isEnabled())) return;

    const settings = await getSettings();
    const hibernateAfter = settings.hibernateAfterMinutes;
    if (!hibernateAfter || hibernateAfter === 'never') return;
    const hibernateAfterMs = hibernateAfter * 60 * 1000;

    // Load per-group opt-out list
    let optOutGroups = [];
    try {
      const result = await browser.storage.local.get(HIBERNATE_OPT_OUT_KEY);
      optOutGroups = result[HIBERNATE_OPT_OUT_KEY] || [];
    } catch (err) {
      console.warn('TabTamer: hibernate — could not load opt-out list', err);
    }

    // Filter to managed groups only
    if (!_managedGroupIds) {
      console.log('TabTamer: hibernate — no managed group IDs, skipping');
      return;
    }
    const allGroups = await browser.tabGroups.query({});
    const managedGroups = allGroups.filter(g => _managedGroupIds.has(g.id));
    const managedGroupIdSet = new Set(managedGroups.map(g => g.id));

    // Build groupId → title map for opt-out check
    const groupIdToTitle = {};
    for (const g of managedGroups) {
      groupIdToTitle[g.id] = g.title;
    }

    // Get active tab IDs per window
    const windows = await browser.windows.getAll({ populate: true });
    const activeTabIds = new Set();
    for (const w of windows) {
      if (w.tabs) {
        for (const t of w.tabs) {
          if (t.active) activeTabIds.add(t.id);
        }
      }
    }

    // Find tabs to discard
    const allTabs = await browser.tabs.query({});
    const now = Date.now();
    const toDiscard = [];

    for (const tab of allTabs) {
      // Skip non-managed groups
      if (!tab.groupId || !managedGroupIdSet.has(tab.groupId)) continue;
      // Skip pinned tabs
      if (tab.pinned) continue;
      // Skip audible tabs
      if (tab.audible) continue;
      // Skip active tabs
      if (activeTabIds.has(tab.id)) continue;
      // Skip already discarded tabs
      if (tab.discarded) continue;

      // Check per-group opt-out
      const groupTitle = groupIdToTitle[tab.groupId];
      if (groupTitle && optOutGroups.includes(groupTitle)) continue;

      // Check idle time
      const lastAccess = _lastAccessTimes[tab.id] || tab.lastAccessed || 0;
      if (now - lastAccess < hibernateAfterMs) continue;

      toDiscard.push(tab.id);
    }

    if (toDiscard.length === 0) {
      console.log('TabTamer: hibernate — no idle tabs to discard');
      return;
    }

    // Discard in batches of 10 to avoid overwhelming the browser
    const batchSize = 10;
    for (let i = 0; i < toDiscard.length; i += batchSize) {
      const batch = toDiscard.slice(i, i + batchSize);
      try {
        await browser.tabs.discard(batch);
      } catch (discardErr) {
        console.warn('TabTamer: hibernate — batch discard error', discardErr.message);
      }
    }

    _hibernatedCount += toDiscard.length;
    console.log(`TabTamer: hibernate — discarded ${toDiscard.length} idle tab(s)`);

    // Show hibernation indicator via badge for 5 seconds (T11.1)
    // Use updateBadge() with the hibernation flag so it doesn't get overwritten
    _hibernationBadgeActive = true;
    updateBadge();
    setTimeout(() => {
      _hibernationBadgeActive = false;
      updateBadge();
    }, 5000);
  } catch (err) {
    console.error('TabTamer: hibernate error', err);
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

// T9.11: Extracted helper to build the merge prompt (system + user messages)
function _buildMergePrompt(groups, tabCountByGroup) {
  // Sort by tab count descending so the most popular groups are included
  const sortedNames = groups
    .map(g => ({ title: g.title, count: tabCountByGroup[g.id] || 0 }))
    .sort((a, b) => b.count - a.count);
  const allNames = sortedNames.map(x => x.title);
  const displayNames = allNames.slice(0, MAX_GROUP_NAMES_IN_PROMPT);
  let namesStr = displayNames.join(', ');
  if (allNames.length > MAX_GROUP_NAMES_IN_PROMPT) {
    namesStr += `, ...and ${allNames.length - MAX_GROUP_NAMES_IN_PROMPT} more`;
  }

  console.log(`TabTamer: group merge — analyzing ${allNames.length} groups: [${namesStr}]`);

  return {
    systemPrompt: 'You are merging similar tab groups. Given these group names, output a JSON object mapping each original name to either its original name (if no merge needed) or the merged name (if it should join another group). Example: {"GitHub PRs": "GitHub", "NixOS": "NixOS"}.',
    userMessage: `Group names: [${namesStr}]`
  };
}

// T9.11: Extracted helper to parse and validate LLM merge response
// Returns { mergeMap, usage } — usage contains token counts from the API response
async function _parseMergeResponse(response) {
  const data = await response.json();
  const usage = data.usage || null;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    console.warn('TabTamer: group merge — empty LLM response');
    return { mergeMap: null, usage };
  }

  let mergeMap;
  try {
    mergeMap = JSON.parse(content);
  } catch (parseErr) {
    console.error('TabTamer: group merge — invalid JSON response', parseErr);
    return { mergeMap: null, usage };
  }

  if (!mergeMap || typeof mergeMap !== 'object') {
    console.error('TabTamer: group merge — unexpected response format');
    return { mergeMap: null, usage };
  }

  return { mergeMap, usage };
}

// T9.11: Extracted helper to apply merges (rename groups / move tabs)
async function _applyMerges(mergeMap, groups) {
  let mergeCount = 0;

  for (const group of groups) {
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

  return mergeCount;
}

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

    const model = resolveModel(settings);
    const endpoint = resolveEndpoint(settings);

    if (!endpoint) {
      console.log('TabTamer: group merge — no API endpoint configured, skipping');
      return;
    }

    if (!model) {
      console.log('TabTamer: group merge — no model configured, skipping');
      return;
    }

    // T8.2: Filter to TabTamer-managed groups only
    if (!_managedGroupIds) {
      console.log('TabTamer: group merge — managed group IDs unavailable, skipping');
      return;
    }
    const groups = (await browser.tabGroups.query({})).filter(g => _managedGroupIds.has(g.id));

    if (groups.length <= 1) {
      console.log('TabTamer: group merge — only 1 group, skipping');
      return;
    }

    // T9.6: Batch tab-count queries — single query + JS counting instead of N individual queries
    const allTabs = await browser.tabs.query({});
    const tabCountByGroup = {};
    for (const tab of allTabs) {
      const gid = tab.groupId;
      if (gid !== undefined && gid !== -1) {
        tabCountByGroup[gid] = (tabCountByGroup[gid] || 0) + 1;
      }
    }

    // Filter to groups with ≥2 tabs
    const mergeableGroups = groups.filter(g => (tabCountByGroup[g.id] || 0) >= 2);

    if (mergeableGroups.length <= 1) {
      console.log('TabTamer: group merge — only 1 mergeable group, skipping');
      return;
    }

    // T9.11: Build the merge prompt via extracted helper
    const { systemPrompt, userMessage } = _buildMergePrompt(mergeableGroups, tabCountByGroup);

    // T5.5: Use unified retry-with-backoff instead of inline duplicate; use MAX_RETRIES constant
    const response = await retryWithBackoff(() => fetch(endpoint, {
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

    // T9.11: Parse LLM response via extracted helper
    const { mergeMap, usage } = await _parseMergeResponse(response);
    if (!mergeMap) {
      return; // Invalid response — leave without merging
    }

    // Compute dynamic token estimate from prompt length
    const estimatedTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
    const actualTokens = usage?.total_tokens;

    // Track cost only for successful merges (not retries)
    await updateCosts(estimatedTokens, actualTokens);

    // T9.11: Apply merges via extracted helper
    const mergeCount = await _applyMerges(mergeMap, mergeableGroups);

    if (mergeCount === 0) {
      console.log('TabTamer: group merge — no merges needed');
    } else {
      console.log(`TabTamer: group merge — complete, ${mergeCount} group(s) merged/renamed`);
    }

    // T5.6: Assign colors to any groups still missing them after merge
    // T8.11: Reload custom colors before (re)assigning colors
    await loadCustomGroupColors();
    await assignColorsToGroups();

    // T4.7: Update badge after group merge
    updateBadge();

    // T10.10: Rebuild "Move to group…" submenu since managed groups may have changed
    rebuildMoveToGroupMenu();
  } catch (err) {
    console.error('TabTamer: group merge error', err);
  }
}

// T5.6: One-time migration — assign colors to existing groups that lack one
async function assignColorsToGroups() {
  try {
    // T8.2: Filter to managed groups only
    if (!_managedGroupIds) {
      console.log('TabTamer: assignColorsToGroups — no managed group IDs, skipping');
      return;
    }
    const groups = (await browser.tabGroups.query({})).filter(g => _managedGroupIds.has(g.id));
    let updatedCount = 0;
    for (const group of groups) {
      if (!group.color && group.title) {
        const color = await getGroupColor(group.title);
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
    for (const [domain, value] of Object.entries(cache)) {
      // T10.15: Normalize entry to get group name (handles both old string and new object format)
      const groupName = _getCacheGroupName(value);
      if (groupName === oldName) {
        // Preserve timestamp if present, otherwise create new entry with timestamp
        const entryTs = _getCacheTimestamp(value);
        cache[domain] = entryTs ? { group: newName, timestamp: entryTs } : _makeCacheEntry(newName);
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

// ─── Context Menu (Re-classify + Move To) ──────────────────────────────────
// T5.8: Manual re-classification via right-click context menu on tabs
// T10.10: One-time "Move to group…" override via right-click context submenu

try {
  browser.contextMenus.create({
    id: 'reclassify-tabtamer',
    title: 'Re-classify with TabTamer',
    contexts: ['tab']
  });
} catch (err) {
  console.error('TabTamer: context menu creation error', err);
}

try {
  browser.contextMenus.create({
    id: 'tabtamer-move-to-group',
    title: 'Move to group\u2026',
    contexts: ['tab']
  });
} catch (err) {
  console.error('TabTamer: move-to-group context menu creation error', err);
}

// T10.10: Rebuild the "Move to group…" submenu with current TabTamer-managed groups
async function rebuildMoveToGroupMenu() {
  // Remove all previous child items
  for (const itemId of _moveToGroupMenuItems) {
    try {
      await browser.contextMenus.remove(itemId);
    } catch (err) {
      // Item may not exist — ignore
    }
  }
  _moveToGroupMenuItems = [];

  try {
    const groups = await browser.tabGroups.query({});
    const managedGroups = _managedGroupIds
      ? groups.filter(g => _managedGroupIds.has(g.id))
      : [];

    if (managedGroups.length === 0) {
      // Show a disabled placeholder so users know the feature exists
      const itemId = 'tabtamer-move-to-none';
      await browser.contextMenus.create({
        id: itemId,
        parentId: 'tabtamer-move-to-group',
        title: 'No groups yet',
        contexts: ['tab'],
        enabled: false
      });
      _moveToGroupMenuItems.push(itemId);
      return;
    }

    for (const group of managedGroups) {
      if (!group.title) continue;
      const encodedName = encodeURIComponent(group.title);
      const itemId = `tabtamer-move-to-${encodedName}`;
      try {
        await browser.contextMenus.create({
          id: itemId,
          parentId: 'tabtamer-move-to-group',
          title: group.title,
          contexts: ['tab']
        });
        _moveToGroupMenuItems.push(itemId);
      } catch (err) {
        console.warn(`TabTamer: could not create menu item for "${group.title}"`, err);
      }
    }
  } catch (err) {
    console.warn('TabTamer: rebuildMoveToGroupMenu error', err);
  }
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

  // T10.10: Handle "Move to group…" child menu item clicks
  if (info.menuItemId.startsWith('tabtamer-move-to-') && info.menuItemId !== 'tabtamer-move-to-group') {
    if (!tab || !tab.id) {
      console.log('TabTamer: move-to-group — no tab available');
      return;
    }

    // Decode the group name from the item ID
    const encodedName = info.menuItemId.replace('tabtamer-move-to-', '');
    let groupName;
    try {
      groupName = decodeURIComponent(encodedName);
    } catch (decodeErr) {
      console.warn('TabTamer: move-to-group — could not decode group name', decodeErr);
      return;
    }

    if (!groupName) {
      console.log('TabTamer: move-to-group — empty group name');
      return;
    }

    console.log(`TabTamer: move-to-group — one-time override, moving tab ${tab.id} to "${groupName}"`);

    // Move the tab to the selected group WITHOUT updating cache or creating a rule
    // This is a one-time override — the domain→group mapping is not cached
    try {
      await assignToGroup(tab.id, groupName);
    } catch (err) {
      if (err.message && err.message.includes('Invalid tab ID')) {
        console.log('TabTamer: move-to-group — tab closed before move completed');
        return;
      }
      console.error('TabTamer: move-to-group — error moving tab', err);
    }
  }
});

// ─── Startup & Install ───────────────────────────────────────────────────────
// Phase 2: Scan ungrouped tabs on startup/install; continue onboarding

browser.runtime.onStartup.addListener(async () => {
  console.log('TabTamer: browser started — running startup scan');
  // T3.5: Clear the "notified no API key" flag so users get one fresh reminder per session
  await browser.storage.local.remove(NO_API_KEY_NOTIFIED_KEY);
  // T4.2: Load managed group IDs from storage BEFORE startup scan
  await loadManagedGroups();
  // T8.11: Load custom group colors
  await loadCustomGroupColors();
  // T9.19: Load tab access times for hibernation tracking
  await loadAccessTimes();
  // T9.3: Load excluded domains into in-memory lookup structures
  await loadExcludedDomains();
  // T9.15: Load recent classifications from storage
  await loadRecentClassifications();
  // T10.8: Load dismissed rule suggestions
  await loadDismissedSuggestions();
  // T10.15: Migrate old-format cache entries to new format with timestamps
  await migrateCacheFormat();
  // T5.6: Assign colors to existing groups without one
  await assignColorsToGroups();
  // T10.17: Update toolbar icon for dark/light theme
  _updateToolbarIcon();
  // T10.17: Listen for system theme changes
  _setupAutoThemeListener();
  // T5.10: startupScan() sets badge to "…" and calls updateBadge() on completion
  startupScan();
  // T10.10: Rebuild the "Move to group…" context submenu with current groups
  rebuildMoveToGroupMenu();

  // Phase 2: Create periodic alarms (includes hibernation alarm)
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

    // T8.11: Load custom group colors
    await loadCustomGroupColors();

    // T9.19: Load tab access times for hibernation tracking
    await loadAccessTimes();

    // T9.3: Load excluded domains into in-memory lookup structures
    await loadExcludedDomains();

    // T9.15: Load recent classifications from storage
    await loadRecentClassifications();

    // T10.8: Load dismissed rule suggestions
    await loadDismissedSuggestions();

    // T10.15: Migrate old-format cache entries to new format with timestamps
    await migrateCacheFormat();

    // T10.10: Rebuild the "Move to group…" context submenu with current groups
    await rebuildMoveToGroupMenu();

    // T5.6: Assign colors to existing groups without one (one-time migration)
    await assignColorsToGroups();

    // T10.17: Update toolbar icon for dark/light theme
    _updateToolbarIcon();
    // T10.17: Listen for system theme changes
    _setupAutoThemeListener();

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

// T10.4: Flush access times on graceful shutdown
browser.runtime.onSuspend.addListener(async () => {
  console.log('TabTamer: browser suspending — flushing access times');
  await flushAccessTimes();
});
