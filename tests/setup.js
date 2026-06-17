// Mock browser API for testing TabTamer background.js in Node.js
const sinon = require('sinon');

const storage = {};
const storageListeners = [];

const mockStorage = {
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

const mockTabGroups = {
  query: sinon.stub().resolves([]),
  create: sinon.stub().callsFake(async ({ title, windowId }) => ({
    id: Math.floor(Math.random() * 1000) + 100, title, windowId,
  })),
  update: sinon.stub().resolves(),
  get: sinon.stub().resolves({ id: 1, title: 'Test', windowId: 1 }),
};

const mockTabs = {
  get: sinon.stub().callsFake(async (tabId) => ({ id: tabId, windowId: 1, url: 'about:blank', title: '' })),
  group: sinon.stub().resolves(),
  update: sinon.stub().resolves(),
  query: sinon.stub().resolves([]),
  onUpdated: { addListener: sinon.stub() },
  onRemoved: { addListener: sinon.stub() },
};

const mockNotifications = { create: sinon.stub().resolves() };

const mockRuntime = {
  onInstalled: { addListener: sinon.stub() },
  onStartup: { addListener: sinon.stub() },
  onMessage: { addListener: sinon.stub() },
  openOptionsPage: sinon.stub().resolves(),
};

const mockAlarms = {
  create: sinon.stub().resolves(),
  onAlarm: { addListener: sinon.stub() },
};

const mockBrowserAction = {
  setBadgeBackgroundColor: sinon.stub().resolves(),
  setBadgeText: sinon.stub().resolves(),
};

const mockCommands = { onCommand: { addListener: sinon.stub() } };

const mockContextMenus = {
  create: sinon.stub().resolves(),
  onClicked: { addListener: sinon.stub() },
};

globalThis.browser = {
  storage: mockStorage,
  tabGroups: mockTabGroups,
  tabs: mockTabs,
  notifications: mockNotifications,
  runtime: mockRuntime,
  alarms: mockAlarms,
  browserAction: mockBrowserAction,
  commands: mockCommands,
  contextMenus: mockContextMenus,
};

globalThis.console = { log: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

function resetMocks() {
  Object.keys(storage).forEach(k => delete storage[k]);
  sinon.resetHistory();
}

module.exports = { resetMocks };
