// TabTamer — content script
// T3.4 / T6.2: Notify background of SPA navigations (pushState/replaceState/popstate/hashchange)
// T7.5: Guard against double-patching; only restore our wrapper; retry connect with backoff

// Guard: prevent double-patching if script is re-injected
if (window.__tabtamerPatched) {
  // Already patched by a previous execution of this script — do nothing
} else {
  window.__tabtamerPatched = true;

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  // Named wrapper functions so we can identity-check before restoring (T7.5)
  function tabtamerPushState(...args) {
    origPush.apply(this, args);
    browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
  }

  function tabtamerReplaceState(...args) {
    origReplace.apply(this, args);
    browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
  }

  // Connect to background with exponential backoff retry
  // Apply patches only after a successful connection (or after all retries exhausted)
  (function connectWithRetry(retriesLeft) {
    let port;
    try {
      port = browser.runtime.connect({ name: 'tabtamer-content' });
    } catch (err) {
      if (retriesLeft > 0) {
        // Exponential backoff: ~500ms, 1s, 2s
        const delay = 500 * Math.pow(2, 3 - retriesLeft);
        setTimeout(() => connectWithRetry(retriesLeft - 1), delay);
      } else {
        console.warn(
          'TabTamer: content script — could not connect to background after retries,',
          'patching without restore-on-disconnect. ERR:', err
        );
        // Apply patches anyway so SPA notifications still work
        history.pushState = tabtamerPushState;
        history.replaceState = tabtamerReplaceState;
      }
      return;
    }

    // T5.3 + T7.5: On disconnect, restore originals and attempt reconnect (T10.3)
    port.onDisconnect.addListener(() => {
      if (history.pushState === tabtamerPushState) {
        history.pushState = origPush;
      }
      if (history.replaceState === tabtamerReplaceState) {
        history.replaceState = origReplace;
      }
      // T10.3: Auto-reconnect with 2s delay when background restarts
      reconnectWithDelay();
    });

    // T10.3: Reconnect loop — try once after 2s; on that port's disconnect, retry again
    function reconnectWithDelay() {
      setTimeout(() => {
        let newPort;
        try {
          newPort = browser.runtime.connect({ name: 'tabtamer-content' });
        } catch (err) {
          console.warn('TabTamer: content script — reconnect failed:', err.message);
          return;
        }
        newPort.onDisconnect.addListener(() => {
          if (history.pushState === tabtamerPushState) {
            history.pushState = origPush;
          }
          if (history.replaceState === tabtamerReplaceState) {
            history.replaceState = origReplace;
          }
          reconnectWithDelay();
        });
        history.pushState = tabtamerPushState;
        history.replaceState = tabtamerReplaceState;
        console.log('TabTamer: content script — reconnected to background');
      }, 2000);
    }

    // Apply patches now that we have a connection with cleanup
    history.pushState = tabtamerPushState;
    history.replaceState = tabtamerReplaceState;
  })(3); // 3 retries

  window.addEventListener('popstate', () => {
    browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
  });

  // T6.2: Catch hash-based SPA routers (e.g., example.com/#/page)
  window.addEventListener('hashchange', () => {
    browser.runtime.sendMessage({ type: 'spaNavigate', url: location.href }).catch(() => {});
  });
}

// --- Content extraction for content-based classification (T12.4) ---

/**
 * Check if an element is visible (not display:none, visibility:hidden).
 * Returns false for detached elements.
 */
function _isVisible(el) {
  if (!el || !el.parentNode) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Extract visible text content from a container element, skipping
 * <nav>, <footer>, <aside>, <script>, <style> and their descendants.
 */
function _extractVisibleText(container, maxChars) {
  const skipTags = new Set(['NAV', 'FOOTER', 'ASIDE', 'SCRIPT', 'STYLE']);
  const parts = [];
  let remaining = maxChars;

  function walk(node) {
    if (remaining <= 0) return;

    // Element node
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (skipTags.has(el.tagName)) return;
      if (!_isVisible(el)) return;
      // Recurse into children
      for (let child of el.childNodes) {
        walk(child);
        if (remaining <= 0) return;
      }
      return;
    }

    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (!text) return;
      // Check parent visibility
      if (node.parentNode && !_isVisible(node.parentNode)) return;
      if (text.length <= remaining) {
        parts.push(text);
        remaining -= text.length;
      } else {
        parts.push(text.slice(0, remaining));
        remaining = 0;
      }
      return;
    }
  }

  walk(container);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract page content for LLM classification.
 * Returns { title, h1, text }.
 */
function extractPageContent() {
  const title = document.title || '';

  // First <h1> text content
  const h1El = document.querySelector('h1');
  const h1 = h1El ? h1El.textContent.trim() : '';

  // Walk DOM from <article>, <main>, or fallback to <body>
  const container = document.querySelector('article') || document.querySelector('main') || document.body;
  const text = container ? _extractVisibleText(container, 500) : '';

  return { title, h1, text };
}

// Listen for extractContent requests from the background
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'extractContent') {
    const content = extractPageContent();
    sendResponse(content);
    return false; // no async response needed
  }
});
