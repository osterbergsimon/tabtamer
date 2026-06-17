const { describe, it, beforeEach } = require('node:test');
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
