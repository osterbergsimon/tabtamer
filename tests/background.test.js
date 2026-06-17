const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resetMocks, mockStorage, mockTabGroups, mockTabs } = require('./setup');

// Load background.js — its top-level listeners register but are no-ops in mock
require('../extension/background.js');

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
    await mockStorage.local.set({ tabtamerSettings: { enabled: true, apiKey: 'sk-test' } });
    const result = await isEnabled();
    assert.strictEqual(result, true);
  });

  it('returns false when enabled is false', async () => {
    await mockStorage.local.set({ tabtamerSettings: { enabled: false } });
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
    await mockStorage.local.set({ tabtamerSettings: { apiKey: 'sk-abc', model: 'deepseek-v4-pro', enabled: true } });
    const settings = await getSettings();
    assert.strictEqual(settings.apiKey, 'sk-abc');
    assert.strictEqual(settings.model, 'deepseek-v4-pro');
    assert.strictEqual(settings.enabled, true);
  });
});

describe('assignToGroup', () => {
  it('creates a new group when none exists', async () => {
    mockTabGroups.query.resolves([]);
    mockTabGroups.create.resolves({ id: 42, title: 'GitHub', windowId: 1 });

    await assignToGroup(1, 'GitHub');

    assert.ok(mockTabGroups.create.calledOnceWith({ title: 'GitHub', windowId: 1 }));
    assert.ok(mockTabs.group.calledOnce);
    assert.deepStrictEqual(mockTabs.group.firstCall.args[0], { tabIds: [1], groupId: 42 });
  });

  it('reuses existing group', async () => {
    mockTabGroups.query.resolves([{ id: 7, title: 'GitHub' }]);

    await assignToGroup(1, 'GitHub');

    assert.ok(mockTabGroups.create.notCalled);
    assert.ok(mockTabs.group.calledOnce);
    assert.deepStrictEqual(mockTabs.group.firstCall.args[0], { tabIds: [1], groupId: 7 });
  });
});
