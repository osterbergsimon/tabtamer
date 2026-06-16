// TabTamer — content script
// T3.4: Notify background of SPA navigations (pushState/replaceState/popstate)

const origPush = history.pushState;
const origReplace = history.replaceState;

// T5.3: Restore original history methods if extension is reloaded/disabled
// Establish a port to detect when the extension context is invalidated
const _port = browser.runtime.connect({name: "tabtamer-content"});
_port.onDisconnect.addListener(() => {
  history.pushState = origPush;
  history.replaceState = origReplace;
});

history.pushState = function (...args) {
  origPush.apply(this, args);
  browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
};

history.replaceState = function (...args) {
  origReplace.apply(this, args);
  browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
};

window.addEventListener('popstate', () => {
  browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
});
