const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { resetMocks, mockStorage, mockTabGroups, mockTabs } = require('./setup');

// Run background.js in global scope (like a <script> tag would)
// Functions like extractDomain, getCachedGroup etc. become global
// Must load constants.js and rules-engine.js first (dependencies)
// Concatenate files so const declarations from dependencies are visible
const moduleCode = [
  fs.readFileSync(require.resolve('../extension/lib/constants.js'), 'utf8'),
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
