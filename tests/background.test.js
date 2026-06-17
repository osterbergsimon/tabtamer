const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const sinon = require('sinon');
const { resetMocks, mockStorage, mockTabGroups, mockTabs } = require('./setup');

// Run background.js in global scope (like a <script> tag would)
// Functions like extractDomain, getCachedGroup etc. become global
// Must load constants.js and rules-engine.js first (dependencies)
// Concatenate files so const declarations from dependencies are visible
const moduleCode = [
  fs.readFileSync(require.resolve('../extension/lib/constants.js'), 'utf8'),
  fs.readFileSync(require.resolve('../extension/lib/utils.js'), 'utf8'),
  fs.readFileSync(require.resolve('../extension/lib/rules-engine.js'), 'utf8'),
  fs.readFileSync(require.resolve('../extension/background.js'), 'utf8'),
].join('\n');
eval(moduleCode);

beforeEach(() => {
  resetMocks();
});

describe('extractDomain', () => {
  it('extracts hostname from https URL', () => {
    assert.strictEqual(extractDomain('https://github.com/NixOS/nixpkgs'), 'github.com');
  });

  it('extracts hostname from http URL', () => {
    assert.strictEqual(extractDomain('http://example.com/path'), 'example.com');
  });

  it('returns null for non-http protocol', () => {
    assert.strictEqual(extractDomain('about:blank'), null);
    assert.strictEqual(extractDomain('moz-extension://id/page'), null);
    assert.strictEqual(extractDomain('chrome://settings'), null);
  });

  it('returns null for malformed URL', () => {
    assert.strictEqual(extractDomain('not-a-url'), null);
    assert.strictEqual(extractDomain(''), null);
  });

  it('handles URLs with subdomains', () => {
    assert.strictEqual(extractDomain('https://mail.google.com/inbox'), 'mail.google.com');
  });

  it('handles URLs with ports', () => {
    assert.strictEqual(extractDomain('https://localhost:8080/test'), 'localhost');
  });
});

describe('cache functions', () => {
  it('getCachedGroup returns null for uncached domain', async () => {
    const result = await getCachedGroup('example.com');
    assert.strictEqual(result, null);
  });

  it('setCachedGroup stores and getCachedGroup retrieves', async () => {
    await setCachedGroup('github.com', 'GitHub');
    const result = await getCachedGroup('github.com');
    assert.strictEqual(result, 'GitHub');
  });

  it('cache is isolated per domain', async () => {
    await setCachedGroup('github.com', 'GitHub');
    const result = await getCachedGroup('nixos.org');
    assert.strictEqual(result, null);
  });
});

describe('isEnabled', () => {
  it('returns true by default (no settings)', async () => {
    const result = await isEnabled();
    assert.strictEqual(result, true);
  });

  it('returns true when enabled is true', async () => {
    await browser.storage.local.set({ tabtamerSettings: { enabled: true, apiKey: 'sk-test' } });
    const result = await isEnabled();
    assert.strictEqual(result, true);
  });

  it('returns false when enabled is false', async () => {
    await browser.storage.local.set({ tabtamerSettings: { enabled: false } });
    const result = await isEnabled();
    assert.strictEqual(result, false);
  });
});

describe('getSettings', () => {
  it('returns empty object when no settings stored', async () => {
    const settings = await getSettings();
    assert.deepStrictEqual(settings, {});
  });

  it('returns stored settings', async () => {
    await browser.storage.local.set({ tabtamerSettings: { apiKey: 'sk-abc', model: 'deepseek-v4-pro', enabled: true } });
    const settings = await getSettings();
    assert.strictEqual(settings.apiKey, 'sk-abc');
    assert.strictEqual(settings.model, 'deepseek-v4-pro');
    assert.strictEqual(settings.enabled, true);
  });
});

describe('assignToGroup', () => {
  it('creates a new group when none exists', async () => {
    browser.tabGroups.query.resolves([]);
    browser.tabGroups.create.resolves({ id: 42, title: 'Code', windowId: 1 });

    await assignToGroup(1, 'Code');

    assert.ok(browser.tabGroups.create.calledOnce);
    assert.strictEqual(browser.tabGroups.create.firstCall.args[0].title, 'Code');
    assert.strictEqual(browser.tabGroups.create.firstCall.args[0].windowId, 1);
    assert.ok(browser.tabs.group.calledOnce);
    assert.deepStrictEqual(browser.tabs.group.firstCall.args[0], { tabIds: [1], groupId: 42 });
  });

  it('reuses existing group', async () => {
    browser.tabGroups.query.resolves([{ id: 7, title: 'GitHub' }]);

    await assignToGroup(1, 'GitHub');

    assert.ok(browser.tabGroups.create.notCalled);
    assert.ok(browser.tabs.group.calledOnce);
    assert.deepStrictEqual(browser.tabs.group.firstCall.args[0], { tabIds: [1], groupId: 7 });
  });
});

describe('hibernation', () => {
  it('updateLastAccess does not throw', () => {
    updateLastAccess(123);
    assert.ok(true, 'updateLastAccess completed without throwing');
  });

  it('hibernateIdleTabs returns early when hibernateAfterMinutes is "never"', async () => {
    await browser.storage.local.set({ tabtamerSettings: { hibernateAfterMinutes: 'never' } });
    await hibernateIdleTabs();
    assert.ok(browser.tabs.discard.notCalled);
  });

  it('hibernateIdleTabs returns early when no managed groups', async () => {
    await browser.storage.local.set({ tabtamerSettings: { hibernateAfterMinutes: 30 } });
    await hibernateIdleTabs();
    assert.ok(browser.tabs.discard.notCalled);
  });

  it('hibernateIdleTabs discards idle tabs in managed groups', async () => {
    // Set up managed groups in storage and load them
    await browser.storage.local.set({
      tabtamerSettings: { hibernateAfterMinutes: 15, enabled: true },
      'tabtamerManagedGroups': [1],
    });
    await loadManagedGroups();

    browser.tabGroups.query.resolves([{ id: 1, title: 'Code' }]);
    browser.windows.getAll.resolves([{ tabs: [{ id: 200, active: true }] }]);

    // Tab 201 has no access time recorded (falls back to 0 → very old → idle)
    browser.tabs.query.resolves([
      { id: 200, groupId: 1, url: 'https://active.com', title: 'Active', pinned: false, audible: false, discarded: false },
      { id: 201, groupId: 1, url: 'https://stale.com', title: 'Stale', pinned: false, audible: false, discarded: false },
    ]);

    // Mark active tab as recently accessed
    updateLastAccess(200);

    await hibernateIdleTabs();

    // Tab 201 has no access time (undefined → 0) so it's idle → discarded
    assert.ok(browser.tabs.discard.calledOnce);
    assert.deepStrictEqual(browser.tabs.discard.firstCall.args[0], [201]);
  });

  it('hibernateIdleTabs does not discard recently accessed tabs', async () => {
    await browser.storage.local.set({
      tabtamerSettings: { hibernateAfterMinutes: 15, enabled: true },
      'tabtamerManagedGroups': [1],
    });
    await loadManagedGroups();

    browser.tabGroups.query.resolves([{ id: 1, title: 'Code' }]);
    browser.windows.getAll.resolves([{ tabs: [] }]);

    browser.tabs.query.resolves([
      { id: 300, groupId: 1, url: 'https://recent.com', title: 'Recent', pinned: false, audible: false, discarded: false },
    ]);

    // Mark tab as recently accessed
    updateLastAccess(300);

    await hibernateIdleTabs();

    // Recently accessed tab should NOT be discarded
    assert.ok(browser.tabs.discard.notCalled);
  });

  it('hibernateIdleTabs respects per-group opt-out', async () => {
    await browser.storage.local.set({
      tabtamerSettings: { hibernateAfterMinutes: 15, enabled: true },
      'tabtamerManagedGroups': [1, 2],
      'tabtamerHibernateOptOut': ['OptedOut'],
    });
    await loadManagedGroups();

    browser.tabGroups.query.resolves([
      { id: 1, title: 'Code' },
      { id: 2, title: 'OptedOut' },
    ]);
    browser.windows.getAll.resolves([{ tabs: [] }]);

    browser.tabs.query.resolves([
      { id: 301, groupId: 1, url: 'https://code.com', title: 'CodeTab', pinned: false, audible: false, discarded: false },
      { id: 302, groupId: 2, url: 'https://opted-out.com', title: 'OptedOutTab', pinned: false, audible: false, discarded: false },
    ]);

    // Both tabs have no access time → both idle
    await hibernateIdleTabs();

    // Only tab in non-opted-out group should be discarded
    assert.ok(browser.tabs.discard.calledOnce);
    assert.deepStrictEqual(browser.tabs.discard.firstCall.args[0], [301]);
  });
});

describe('rule suggestion (T10.8)', () => {
  beforeEach(() => {
    _resetSuggestionState();
  });

  it('_showRuleSuggestion shows notification for new domain', async () => {
    await _showRuleSuggestion('github.com', 'Code');
    assert.ok(browser.notifications.create.calledOnce);
    const callArgs = browser.notifications.create.firstCall.args;
    // First arg is notificationId
    assert.strictEqual(callArgs[0], 'tabtamer-rule-suggest-github.com');
    // Second arg is options
    assert.strictEqual(callArgs[1].title, 'TabTamer');
    assert.ok(callArgs[1].message.includes('github.com'));
    assert.ok(callArgs[1].message.includes('Code'));
    // Domain should be tracked per-session via accessor
    assert.ok(_isDomainSuggested('github.com'));
    // Pending map should have the entry via accessor
    assert.ok(_hasPendingSuggestion('github.com'));
  });

  it('_showRuleSuggestion skips if domain already suggested in session', async () => {
    // Call once — sets suggested
    await _showRuleSuggestion('github.com', 'Code');
    assert.ok(browser.notifications.create.calledOnce);

    // Call again — should skip because domain already suggested
    await _showRuleSuggestion('github.com', 'Dev');
    assert.ok(browser.notifications.create.calledOnce); // still called only once
  });

  it('_showRuleSuggestion skips if domain matches existing rule', async () => {
    // Add a rule to storage directly (use known key string)
    await browser.storage.local.set({
      'tabtamerRules': [{ pattern: 'github.com', groupName: 'Code', enabled: true }]
    });
    await _showRuleSuggestion('github.com', 'Dev');
    // Should not show notification since a rule already exists
    assert.ok(browser.notifications.create.notCalled);
  });

  it('_showRuleSuggestion skips if dismissed within 30 days', async () => {
    // Set dismissed suggestion via storage and load
    const oneHourAgo = Date.now() - 3600000;
    await browser.storage.local.set({
      'tabtamerDismissedRuleSuggestions': { 'github.com': oneHourAgo }
    });
    await loadDismissedSuggestions();

    await _showRuleSuggestion('github.com', 'Code');
    assert.ok(browser.notifications.create.notCalled);
    // Domain should be tracked per-session
    assert.ok(_isDomainSuggested('github.com'));
  });

  it('_showRuleSuggestion shows notification if dismissed more than 30 days ago', async () => {
    // Set very old dismissed suggestion (40 days ago) via storage and load
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await browser.storage.local.set({
      'tabtamerDismissedRuleSuggestions': { 'github.com': fortyDaysAgo }
    });
    await loadDismissedSuggestions();

    await _showRuleSuggestion('github.com', 'Code');
    assert.ok(browser.notifications.create.calledOnce);
  });

  it('loadDismissedSuggestions loads from storage and prunes old entries', async () => {
    const oldTimestamp = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    const recentTimestamp = Date.now() - 3600000; // 1 hour ago
    await browser.storage.local.set({
      'tabtamerDismissedRuleSuggestions': {
        'old-domain.com': oldTimestamp,
        'recent-domain.com': recentTimestamp,
      }
    });
    await loadDismissedSuggestions();
    const dismissed = _getDismissedSuggestions();
    // Old entry should be pruned (older than 35 days)
    assert.strictEqual(dismissed['old-domain.com'], undefined);
    // Recent entry should remain
    assert.strictEqual(dismissed['recent-domain.com'], recentTimestamp);
  });

  it('_handleRuleSuggestionClick approves rule suggestion', async () => {
    // First show a suggestion to populate pending data
    await _showRuleSuggestion('github.com', 'Code');
    assert.ok(browser.notifications.create.calledOnce);

    // Simulate clicking the notification by calling the handler directly
    await _handleRuleSuggestionClick('tabtamer-rule-suggest-github.com');

    // Check that a rule was created in storage
    const storageResult = await browser.storage.local.get('tabtamerRules');
    const rules = storageResult['tabtamerRules'] || [];
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].pattern, 'github.com');
    assert.strictEqual(rules[0].groupName, 'Code');
    assert.strictEqual(rules[0].enabled, true);

    // Pending data should be cleaned up
    assert.ok(!_hasPendingSuggestion('github.com'));
  });

  it('_handleRuleSuggestionClick ignores non-rule-suggestion IDs', async () => {
    // Should not throw for unknown notification ID
    await _handleRuleSuggestionClick('tabtamer-toggle');
    // Should not throw for non-tabtamer notification
    await _handleRuleSuggestionClick('some-other-notification');
    assert.ok(true); // no crash = pass
  });

  it('_handleRuleSuggestionClick handles missing pending data gracefully', async () => {
    // No pending data for this notification
    await _handleRuleSuggestionClick('tabtamer-rule-suggest-unknown.com');
    // Should not throw, just log a warning
    assert.ok(console.log.calledWith(sinon.match(/no pending data found/)));
  });
});

describe('utils cache helpers (T11.2)', () => {
  it('_getCacheGroupName returns group from object format', () => {
    const result = _getCacheGroupName({ group: 'Code', timestamp: 123 });
    assert.strictEqual(result, 'Code');
  });

  it('_getCacheGroupName returns string from old format', () => {
    assert.strictEqual(_getCacheGroupName('Code'), 'Code');
  });

  it('_getCacheGroupName returns null for null/undefined', () => {
    assert.strictEqual(_getCacheGroupName(null), null);
    assert.strictEqual(_getCacheGroupName(undefined), null);
  });

  it('_getCacheGroupName returns null for empty object', () => {
    assert.strictEqual(_getCacheGroupName({}), null);
  });

  it('_getCacheTimestamp returns timestamp from object format', () => {
    assert.strictEqual(_getCacheTimestamp({ group: 'Code', timestamp: 456 }), 456);
  });

  it('_getCacheTimestamp returns null for old string format', () => {
    assert.strictEqual(_getCacheTimestamp('Code'), null);
  });

  it('_getCacheTimestamp returns null for null/undefined', () => {
    assert.strictEqual(_getCacheTimestamp(null), null);
    assert.strictEqual(_getCacheTimestamp(undefined), null);
  });
});

describe('loadManagedGroups (T11.7)', () => {
  it('initializes to empty Set on storage failure', async () => {
    browser.storage.local.get.rejects(new Error('Storage error'));
    await loadManagedGroups();
    assert.ok(_managedGroupIds instanceof Set);
    assert.strictEqual(_managedGroupIds.size, 0);
  });

  it('initializes to Set from stored array', async () => {
    await browser.storage.local.set({ 'tabtamerManagedGroups': [1, 2, 3] });
    await loadManagedGroups();
    assert.ok(_managedGroupIds instanceof Set);
    assert.strictEqual(_managedGroupIds.size, 3);
    assert.ok(_managedGroupIds.has(1));
    assert.ok(_managedGroupIds.has(3));
  });

  it('initializes to empty Set when storage is empty', async () => {
    await loadManagedGroups();
    assert.ok(_managedGroupIds instanceof Set);
    assert.strictEqual(_managedGroupIds.size, 0);
  });

  it('loadManagedGroups resets in-memory state when called', async () => {
    // First populate the set
    await browser.storage.local.set({ 'tabtamerManagedGroups': [10, 20] });
    await loadManagedGroups();
    assert.strictEqual(_managedGroupIds.size, 2);

    // Then re-call with different data
    await browser.storage.local.set({ 'tabtamerManagedGroups': [30] });
    await loadManagedGroups();
    assert.strictEqual(_managedGroupIds.size, 1);
    assert.ok(_managedGroupIds.has(30));
    assert.ok(!_managedGroupIds.has(10));
  });
});

describe('_classifyTabPreLLM (T11.9)', () => {
  it('returns { matched: false, domain } for uncached domain', async () => {
    // Mock tabs.get to return a tab with no group
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    const result = await _classifyTabPreLLM(1, 'https://example.com', 'Example');
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.domain, 'example.com');
  });

  it('returns { matched: true } when rule matches', async () => {
    // Set up a rule in storage
    await browser.storage.local.set({
      'tabtamerRules': [{ pattern: 'example.com', groupName: 'Code', enabled: true }]
    });

    // Mock tabs.get to return a tab with no group
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    // Set up assignToGroup mocks
    browser.tabGroups.query.resolves([]);
    browser.tabGroups.create.resolves({ id: 42, title: 'Code', windowId: 1 });

    const result = await _classifyTabPreLLM(1, 'https://example.com', 'Example');
    assert.strictEqual(result.matched, true);
    // Verify tab was assigned to group
    assert.ok(browser.tabGroups.create.calledOnce);
    assert.strictEqual(browser.tabGroups.create.firstCall.args[0].title, 'Code');
    // Verify recent classification was stored with source 'rule'
    assert.strictEqual(_recentClassifications.length, 1);
    assert.strictEqual(_recentClassifications[0].source, 'rule');
  });

  it('returns { matched: true } when cache matches', async () => {
    // Set up a cache entry using a name normalizeGroupName doesn't change
    await browser.storage.local.set({
      'domainGroupCache': { 'example.com': { group: 'Code', timestamp: Date.now() } }
    });

    // Mock tabs.get to return a tab with no group
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    // Set up assignToGroup mocks
    browser.tabGroups.query.resolves([]);
    browser.tabGroups.create.resolves({ id: 43, title: 'Code', windowId: 1 });

    const result = await _classifyTabPreLLM(1, 'https://example.com/page', 'Example');
    assert.strictEqual(result.matched, true);
    assert.ok(browser.tabGroups.create.calledOnce);
    assert.strictEqual(browser.tabGroups.create.firstCall.args[0].title, 'Code');
    // Verify recent classification was stored with source 'cache'
    assert.strictEqual(_recentClassifications[0].source, 'cache');
  });

  it('returns { matched: true } for non-http URLs', async () => {
    const result = await _classifyTabPreLLM(1, 'about:blank', 'Blank');
    assert.strictEqual(result.matched, true);
  });

  it('returns { matched: true } for excluded domain', async () => {
    // Set up excluded domain
    await browser.storage.local.set({
      'tabtamerExcludedDomains': ['example.com']
    });
    // Load excluded domains into memory
    await loadExcludedDomains();

    // Mock tabs.get to return a tab with no group
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    const result = await _classifyTabPreLLM(1, 'https://example.com', 'Example');
    assert.strictEqual(result.matched, true);
  });

  it('uses isEnabledParam when provided, avoids redundant storage read (T12.2)', async () => {
    // When isEnabledParam is passed, _classifyTabPreLLM should skip calling isEnabled()
    // and use the passed value directly. With isEnabledParam=false, it returns
    // { matched: true } immediately without any storage access or tab lookup.
    browser.storage.local.get.resetHistory();

    const result = await _classifyTabPreLLM(1, 'https://example.com', 'Example', false);
    assert.strictEqual(result.matched, true);

    // Verify isEnabled() was NOT called — no storage read for SETTINGS_KEY
    // The function returns before any async operations when isEnabledParam is false
    const getCalls = browser.storage.local.get.getCalls();
    const settingsKeyCalls = getCalls.filter(c => {
      const args = c.args[0];
      return args === 'tabtamerSettings' ||
        (Array.isArray(args) && args.includes('tabtamerSettings')) ||
        (typeof args === 'object' && args !== null && 'tabtamerSettings' in args);
    });
    assert.strictEqual(settingsKeyCalls.length, 0,
      'isEnabled() should not be called when isEnabledParam is provided');
  });

  it('calls isEnabled() internally when isEnabledParam is omitted (T12.2)', async () => {
    // When isEnabledParam is not passed (standalone callers), _classifyTabPreLLM
    // should call isEnabled() to determine the enabled state.
    // Default isEnabled() returns true, so the function proceeds to check tab info.
    browser.tabs.get.resolves({ id: 1, windowId: 1, groupId: -1 });

    await _classifyTabPreLLM(1, 'https://example.com', 'Example');

    // Verify storage.local.get WAS called for settings (isEnabled() was called)
    const getCalls = browser.storage.local.get.getCalls();
    const settingsKeyCalls = getCalls.filter(c => {
      const args = c.args[0];
      return args === 'tabtamerSettings' ||
        (Array.isArray(args) && args.includes('tabtamerSettings')) ||
        (typeof args === 'object' && args !== null && 'tabtamerSettings' in args);
    });
    assert.ok(settingsKeyCalls.length > 0,
      'isEnabled() should be called when isEnabledParam is not provided');
  });
});

describe('batchClassifyTabs (T11.9)', () => {
  let originalFetch;

  beforeEach(() => {
    // Save and stub global fetch
    originalFetch = globalThis.fetch;
    globalThis.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"groups": [{"name": "Code", "tabIndices": [0]}]}' } }],
        usage: { total_tokens: 50 }
      })
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Reset module-level state that batchClassifyTabs may have modified
    _recentClassifications.length = 0;
  });

  it('returns early for empty input', async () => {
    await batchClassifyTabs([]);
    // Should not have called fetch
    assert.strictEqual(globalThis.fetch.called, false);
  });

  it('falls back to individual classify when no API key', async () => {
    // Set empty settings (no API key)
    await browser.storage.local.set({ tabtamerSettings: { enabled: true } });

    await batchClassifyTabs([
      { tabId: 1, url: 'https://example.com', title: 'Test', domain: 'example.com' }
    ]);

    // Should NOT have called fetch directly (falls back before LLM call)
    assert.strictEqual(globalThis.fetch.called, false);
  });

  it('falls back to individual when no endpoint configured', async () => {
    // Set API key but custom endpoint empty
    await browser.storage.local.set({
      tabtamerSettings: { apiKey: 'sk-test', providerPreset: 'custom', customEndpoint: '', enabled: true }
    });

    await batchClassifyTabs([
      { tabId: 1, url: 'https://example.com', title: 'Test', domain: 'example.com' }
    ]);

    // Should NOT have called fetch directly (falls back before LLM call)
    assert.strictEqual(globalThis.fetch.called, false);
  });

  it('processes LLM response and assigns tabs to groups', async () => {
    // Set up API key so batch path is taken
    await browser.storage.local.set({ tabtamerSettings: { apiKey: 'sk-test', enabled: true } });

    // Mock no existing groups
    browser.tabGroups.query.resolves([]);
    browser.tabs.query.resolves([]);

    // Mock tabs.get for assignToGroup (default returns windowId: 1)
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    // Mock tabGroups.create for new group
    browser.tabGroups.create.resolves({ id: 42, title: 'Code', windowId: 1 });

    await batchClassifyTabs([
      { tabId: 1, url: 'https://github.com', title: 'GitHub', domain: 'github.com' }
    ]);

    // Verify fetch was called for the LLM
    assert.ok(globalThis.fetch.calledOnce, 'fetch should be called once for LLM');

    // Verify tab was moved to a group
    assert.ok(browser.tabs.group.calledOnce, 'tabs.group should be called once');

    // Verify recent classification was added with 'llm' source
    assert.strictEqual(_recentClassifications.length, 1);
    assert.strictEqual(_recentClassifications[0].source, 'llm');
    assert.strictEqual(_recentClassifications[0].domain, 'github.com');
    assert.strictEqual(_recentClassifications[0].group, 'Code');
  });

  it('falls back to individual when LLM returns invalid JSON', async () => {
    await browser.storage.local.set({ tabtamerSettings: { apiKey: 'sk-test', enabled: true } });
    browser.tabGroups.query.resolves([]);
    browser.tabs.query.resolves([]);
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    // Mock LLM returns invalid JSON
    globalThis.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'NOT JSON' } }],
        usage: { total_tokens: 50 }
      })
    });

    await batchClassifyTabs([
      { tabId: 1, url: 'https://example.com', title: 'Test', domain: 'example.com' }
    ]);

    // Should fall back to individual classify (no crash)
    assert.ok(true, 'completed without error');
  });

  it('falls back to individual when LLM response is missing groups array', async () => {
    await browser.storage.local.set({ tabtamerSettings: { apiKey: 'sk-test', enabled: true } });
    browser.tabGroups.query.resolves([]);
    browser.tabs.query.resolves([]);
    browser.tabs.get.resolves({ id: 1, windowId: 1 });

    // Mock LLM returns valid JSON but with wrong structure
    globalThis.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"foo": "bar"}' } }],
        usage: { total_tokens: 50 }
      })
    });

    await batchClassifyTabs([
      { tabId: 1, url: 'https://example.com', title: 'Test', domain: 'example.com' }
    ]);

    assert.ok(true, 'completed without error');
  });

  it('handles multiple tabs and assigns based on indices', async () => {
    await browser.storage.local.set({ tabtamerSettings: { apiKey: 'sk-test', enabled: true } });
    browser.tabGroups.query.resolves([]);
    browser.tabs.query.resolves([]);

    // Mock two tabs with different windowIds for group creation
    browser.tabs.get.callsFake(async (tabId) => {
      if (tabId === 1) return { id: 1, windowId: 1 };
      if (tabId === 2) return { id: 2, windowId: 1 };
      return { id: tabId, windowId: 1 };
    });

    // Mock group creation to return sequential IDs
    let groupCounter = 100;
    browser.tabGroups.create.callsFake(async ({ title, windowId }) => {
      return { id: ++groupCounter, title, windowId };
    });

    // Mock LLM returns two groups
    globalThis.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '{"groups": [{"name": "Dev", "tabIndices": [0]}, {"name": "Work", "tabIndices": [1]}]}'
          }
        }],
        usage: { total_tokens: 80 }
      })
    });

    await batchClassifyTabs([
      { tabId: 1, url: 'https://dev.local', title: 'Dev', domain: 'dev.local' },
      { tabId: 2, url: 'https://work.local', title: 'Work', domain: 'work.local' }
    ]);

    // Verify two groups were created
    assert.strictEqual(browser.tabGroups.create.callCount, 2);
    assert.strictEqual(browser.tabGroups.create.firstCall.args[0].title, 'Dev');
    assert.strictEqual(browser.tabGroups.create.secondCall.args[0].title, 'Work');

    // Verify tabs were moved to groups
    assert.strictEqual(browser.tabs.group.callCount, 2);

    // Verify recent classifications
    assert.strictEqual(_recentClassifications.length, 2);
    assert.strictEqual(_recentClassifications[0].source, 'llm');
    assert.strictEqual(_recentClassifications[1].source, 'llm');
  });
});

describe('badge hibernation flag (T11.1)', () => {
  afterEach(() => {
    // Reset module-level state
    _hibernationBadgeActive = false;
    if (_badgeDebounceTimer) {
      clearTimeout(_badgeDebounceTimer);
      _badgeDebounceTimer = null;
    }
  });

  it('_hibernationBadgeActive adds 💤 prefix to badge text when enabled', async () => {
    // Set up minimal state
    await browser.storage.local.set({
      tabtamerSettings: { enabled: true },
      'tabtamerManagedGroups': [1]
    });
    await loadManagedGroups();

    // Mock tabGroups query to return one managed group
    browser.tabGroups.query.resolves([{ id: 1, title: 'Code' }]);

    // Set hibernation badge flag
    _hibernationBadgeActive = true;
    await updateBadge(false);

    // Wait for debounce (500ms)
    await new Promise(r => setTimeout(r, 600));

    // Verify badge has 💤 prefix
    assert.ok(browser.browserAction.setBadgeText.calledOnce);
    const badgeArgs = browser.browserAction.setBadgeText.firstCall.args[0];
    assert.ok(badgeArgs.text.startsWith('💤'), `Expected 💤 prefix, got "${badgeArgs.text}"`);
    assert.ok(badgeArgs.text.includes('1'), 'Badge should include group count');

    // Now test without hibernation flag
    _hibernationBadgeActive = false;
    browser.browserAction.setBadgeText.resetHistory();
    await updateBadge(false);
    await new Promise(r => setTimeout(r, 600));

    // Verify badge does NOT have 💤 prefix
    assert.ok(browser.browserAction.setBadgeText.calledOnce);
    const badgeArgs2 = browser.browserAction.setBadgeText.firstCall.args[0];
    assert.ok(!badgeArgs2.text.startsWith('💤'), 'Badge should NOT have 💤 prefix when hibernation is not active');
  });

  it('hibernateIdleTabs sets hibernation flag when discarding tabs', async () => {
    // Set up managed groups
    await browser.storage.local.set({
      tabtamerSettings: { hibernateAfterMinutes: 15, enabled: true },
      'tabtamerManagedGroups': [1],
    });
    await loadManagedGroups();

    // Mock groups and tabs
    browser.tabGroups.query.resolves([{ id: 1, title: 'Code' }]);
    browser.windows.getAll.resolves([{ tabs: [{ id: 2, active: true }] }]);

    // Tab 101 has no access time → idle
    browser.tabs.query.resolves([
      { id: 2, groupId: 0, active: true, pinned: false, audible: false, discarded: false },
      { id: 101, groupId: 1, url: 'https://stale.com', title: 'Stale', pinned: false, audible: false, discarded: false }
    ]);

    _hibernationBadgeActive = false;
    await hibernateIdleTabs();

    // Should have set the hibernation flag
    assert.ok(_hibernationBadgeActive, 'hibernationBadgeActive should be true after discarding');

    // Verify updateBadge was called (via debounce, may not have executed yet)
    // The flag being set is the main contract
  });
});
