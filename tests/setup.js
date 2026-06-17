// Mock browser API for testing TabTamer background.js in Node.js
const sinon = require('sinon');

const storage = {};
const storageListeners = [];

function createStorageMocks() {
  return {
    local: {
      get: sinon.stub().callsFake(async (keys) => {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { result[k] = storage[k]; });
        } else if (typeof keys === 'string') {
          result[keys] = storage[keys];
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach(k => { result[k] = storage[k]; });
        }
        return result;
      }),
      set: sinon.stub().callsFake(async (items) => {
        Object.assign(storage, items);
      }),
      remove: sinon.stub().callsFake(async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storage[k]);
      }),
      clear: sinon.stub().resolves(),
    },
    onChanged: { addListener: sinon.stub() },
  };
}

function createTabGroupsMocks() {
  return {
    query: sinon.stub().resolves([]),
    create: sinon.stub().callsFake(async ({ title, windowId }) => ({
      id: Math.floor(Math.random() * 1000) + 100, title, windowId,
    })),
    update: sinon.stub().resolves(),
    get: sinon.stub().resolves({ id: 1, title: 'Test', windowId: 1 }),
  };
}

function createTabsMocks() {
  return {
    get: sinon.stub().callsFake(async (tabId) => ({ id: tabId, windowId: 1, url: 'about:blank', title: '' })),
    group: sinon.stub().resolves(),
    update: sinon.stub().resolves(),
    query: sinon.stub().resolves([]),
    discard: sinon.stub().resolves(),
    onUpdated: { addListener: sinon.stub() },
    onRemoved: { addListener: sinon.stub() },
    onActivated: { addListener: sinon.stub() },
  };
}

function createNotificationsMocks() {
  return {
    create: sinon.stub().resolves(),
    onClicked: { addListener: sinon.stub() },
  };
}

function createRuntimeMocks() {
  return {
    onInstalled: { addListener: sinon.stub() },
    onStartup: { addListener: sinon.stub() },
    onMessage: { addListener: sinon.stub() },
    onSuspend: { addListener: sinon.stub() },
    openOptionsPage: sinon.stub().resolves(),
  };
}

function createAlarmsMocks() {
  return {
    create: sinon.stub().resolves(),
    onAlarm: { addListener: sinon.stub() },
  };
}

function createBrowserActionMocks() {
  return {
    setBadgeBackgroundColor: sinon.stub().resolves(),
    setBadgeText: sinon.stub().resolves(),
  };
}

function createWindowsMocks() {
  return {
    getAll: sinon.stub().resolves([]),
  };
}

function createCommandsMocks() {
  return { onCommand: { addListener: sinon.stub() } };
}

function createContextMenusMocks() {
  return {
    create: sinon.stub().resolves(),
    remove: sinon.stub().resolves(),
    onClicked: { addListener: sinon.stub() },
  };
}

let mockStorage = createStorageMocks();
let mockTabGroups = createTabGroupsMocks();
let mockTabs = createTabsMocks();
let mockNotifications = createNotificationsMocks();
let mockRuntime = createRuntimeMocks();
let mockAlarms = createAlarmsMocks();
let mockBrowserAction = createBrowserActionMocks();
let mockWindows = createWindowsMocks();
let mockCommands = createCommandsMocks();
let mockContextMenus = createContextMenusMocks();

function buildBrowser() {
  return {
    storage: mockStorage,
    tabGroups: mockTabGroups,
    tabs: mockTabs,
    notifications: mockNotifications,
    runtime: mockRuntime,
    alarms: mockAlarms,
    browserAction: mockBrowserAction,
    windows: mockWindows,
    commands: mockCommands,
    contextMenus: mockContextMenus,
  };
}

globalThis.browser = buildBrowser();
globalThis.console = { log: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

function resetMocks() {
  Object.keys(storage).forEach(k => delete storage[k]);
  // Recreate all stubs so that both history AND behavior are fresh
  // This prevents stub behavior changes from one test leaking into subsequent tests
  mockStorage = createStorageMocks();
  mockTabGroups = createTabGroupsMocks();
  mockTabs = createTabsMocks();
  mockNotifications = createNotificationsMocks();
  mockRuntime = createRuntimeMocks();
  mockAlarms = createAlarmsMocks();
  mockBrowserAction = createBrowserActionMocks();
  mockWindows = createWindowsMocks();
  mockCommands = createCommandsMocks();
  mockContextMenus = createContextMenusMocks();
  globalThis.browser = buildBrowser();
}

module.exports = { resetMocks, mockStorage, mockTabGroups, mockTabs };
