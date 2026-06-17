// TabTamer — Smart Tab Search (Quick Switcher)
// T8.10: Command-palette-style tab switcher with fuzzy-search filtering

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Array<{id: number, title: string, url: string, windowId: number, groupId: number, groupName: string, groupColor: string, domain: string}>} */
let allTabs = [];

/** @type {Array<{id: number, title: string, url: string, windowId: number, groupId: number, groupName: string, groupColor: string, domain: string}>} */
let filteredTabs = [];

let selectedIndex = 0;
let searchTabId = null;

/** @type {Set<number>} Set of tab IDs selected via checkboxes for batch operations */
let selectedTabs = new Set();

/** @type {number|null} Timeout ID for auto-dismissing the current toast */
let toastTimeout = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results-container');
const resultCountEl = document.getElementById('result-count');
const totalCountEl = document.getElementById('total-count');
const windowCountEl = document.getElementById('window-count');

// ─── Theme ────────────────────────────────────────────────────────────────────

async function applyTheme() {
  try {
    const result = await browser.storage.local.get('tabtamerSettings');
    const settings = result.tabtamerSettings || {};
    const theme = settings.theme || 'system';
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (err) {
    console.error('TabTamer search: failed to apply theme', err);
  }
}

// ─── Data Loading ────────────────────────────────────────────────────────────

async function loadData() {
  try {
    // Get all tabs
    const tabs = await browser.tabs.query({});

    // Get all groups for name/color mapping
    const groups = await browser.tabGroups.query({});
    const groupMap = {};
    for (const g of groups) {
      groupMap[g.id] = { title: g.title || '', color: g.color || 'grey' };
    }

    // Get all windows for labeling
    const windows = await browser.windows.getAll({});
    const windowLabels = {};
    for (const w of windows) {
      windowLabels[w.id] = w.incognito ? 'Private' : `Window ${Object.keys(windowLabels).length + 1}`;
    }

    // Find our own tab ID
    const searchUrl = browser.runtime.getURL('search.html');
    const searchTabs = await browser.tabs.query({ url: searchUrl });
    if (searchTabs.length > 0) {
      searchTabId = searchTabs[0].id;
    }

    // Build tab index, excluding internal pages
    allTabs = [];
    for (const tab of tabs) {
      if (!tab.url) continue;
      if (tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) continue;
      if (tab.id === searchTabId) continue; // Exclude self

      const domain = extractDomainSimple(tab.url);
      const groupInfo = tab.groupId > 0 ? (groupMap[tab.groupId] || { title: '', color: 'grey' }) : { title: '', color: 'grey' };

      allTabs.push({
        id: tab.id,
        title: tab.title || '(no title)',
        url: tab.url,
        windowId: tab.windowId,
        groupId: tab.groupId,
        groupName: groupInfo.title,
        groupColor: groupInfo.color,
        domain: domain,
        windowLabel: windowLabels[tab.windowId] || `Window ${tab.windowId}`
      });
    }

    // Sort: grouped tabs first, then by window
    allTabs.sort((a, b) => {
      if (a.groupName && !b.groupName) return -1;
      if (!a.groupName && b.groupName) return 1;
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return (a.title || '').localeCompare(b.title || '');
    });

    // Update total count
    totalCountEl.textContent = allTabs.length;

    // Show window count
    const windowCount = Object.keys(windowLabels).length;
    windowCountEl.textContent = `${windowCount} window${windowCount !== 1 ? 's' : ''}`;

    // Initial render
    filteredTabs = allTabs;
    renderResults();
    updateStatus();

  } catch (err) {
    console.error('TabTamer search: failed to load data', err);
    resultsContainer.innerHTML = '<div class="error-state">Failed to load tabs. Try refreshing.</div>';
  }
}

// ─── Simple domain extraction (no dependency on utils.js) ────────────────────

function extractDomainSimple(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return '';
  }
}

// ─── Fuzzy Search (substring matching) ────────────────────────────────────────

function normalize(text) {
  return text.toLowerCase().trim();
}

function matchesSubstring(term, text) {
  if (!term || !text) return false;
  return normalize(text).includes(normalize(term));
}

function search(query) {
  if (!query || !query.trim()) {
    filteredTabs = allTabs;
  } else {
    const q = query.trim();
    filteredTabs = allTabs.filter(tab => {
      return matchesSubstring(q, tab.title) ||
             matchesSubstring(q, tab.url) ||
             matchesSubstring(q, tab.groupName) ||
             matchesSubstring(q, tab.domain);
    });
  }

  // Reset selection
  selectedIndex = 0;
  renderResults();
  updateStatus();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function truncateUrl(url, maxLen = 80) {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}

function highlightText(text, query) {
  if (!query || !query.trim()) return escapeHtml(text);
  const q = normalize(query);
  const lower = text.toLowerCase();
  const parts = [];
  let lastIndex = 0;

  let idx = lower.indexOf(q, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(escapeHtml(text.substring(lastIndex, idx)));
    }
    parts.push('<mark>' + escapeHtml(text.substring(idx, idx + q.length)) + '</mark>');
    lastIndex = idx + q.length;
    idx = lower.indexOf(q, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.substring(lastIndex)));
  }
  return parts.join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderResults() {
  if (filteredTabs.length === 0) {
    resultsContainer.innerHTML = '<div class="empty-state">No tabs match your search</div>';
    return;
  }

  const query = searchInput.value;
  const items = filteredTabs.map((tab, index) => {
    const isSelected = index === selectedIndex;
    const titleHtml = highlightText(tab.title || '(no title)', query);
    const urlDisplay = truncateUrl(tab.url);
    const urlHtml = highlightText(urlDisplay, query);
    const groupTag = tab.groupName
      ? `<span class="result-group-tag" style="border-color: var(--primary);">${escapeHtml(tab.groupName)}</span>`
      : '';
    const windowLabel = `<span class="result-window-label">${escapeHtml(tab.windowLabel)}</span>`;

    // First letter for the icon
    const initial = (tab.groupName || tab.title || '?').charAt(0).toUpperCase();

    return `<div class="result-item${isSelected ? ' selected' : ''}" data-index="${index}">
      <div class="result-icon group-color-${tab.groupColor || 'grey'}">${initial}</div>
      <div class="result-info">
        <div class="result-title">${titleHtml}</div>
        <div class="result-url">${urlHtml}</div>
      </div>
      ${groupTag}
      ${windowLabel}
    </div>`;
  }).join('');

  resultsContainer.innerHTML = items;

  // Ensure selected item is visible
  const selectedEl = resultsContainer.querySelector('.result-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function updateStatus() {
  resultCountEl.textContent = filteredTabs.length;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigate(direction) {
  if (filteredTabs.length === 0) return;

  if (direction === 'down') {
    selectedIndex = Math.min(selectedIndex + 1, filteredTabs.length - 1);
  } else if (direction === 'up') {
    selectedIndex = Math.max(selectedIndex - 1, 0);
  }

  renderResults();
}

async function selectCurrent() {
  if (filteredTabs.length === 0 || selectedIndex < 0 || selectedIndex >= filteredTabs.length) return;

  const tab = filteredTabs[selectedIndex];

  try {
    // Switch to the selected tab
    await browser.tabs.update(tab.id, { active: true });

    // Focus the window (if not already focused)
    try {
      await browser.windows.update(tab.windowId, { focused: true });
    } catch (focusErr) {
      // Non-critical — the tab is active even if window focus fails
      console.warn('TabTamer search: could not focus window', focusErr.message);
    }
  } catch (err) {
    console.error('TabTamer search: failed to switch tab', err);
    return;
  }

  // Close the search tab
  try {
    if (searchTabId) {
      await browser.tabs.remove(searchTabId);
    } else {
      // Fallback: find and close self
      const searchUrl = browser.runtime.getURL('search.html');
      const tabs = await browser.tabs.query({ url: searchUrl });
      for (const t of tabs) {
        await browser.tabs.remove(t.id);
      }
    }
  } catch (closeErr) {
    console.warn('TabTamer search: could not close search tab', closeErr.message);
  }
}

async function closeSearch() {
  try {
    if (searchTabId) {
      await browser.tabs.remove(searchTabId);
    } else {
      const searchUrl = browser.runtime.getURL('search.html');
      const tabs = await browser.tabs.query({ url: searchUrl });
      for (const t of tabs) {
        await browser.tabs.remove(t.id);
      }
    }
  } catch (err) {
    console.warn('TabTamer search: could not close', err.message);
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  search(searchInput.value);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    navigate('down');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    navigate('up');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    selectCurrent();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    closeSearch();
  }
});

// Click on a result item
resultsContainer.addEventListener('click', (e) => {
  const item = e.target.closest('.result-item');
  if (!item) return;

  const index = parseInt(item.dataset.index, 10);
  if (!isNaN(index)) {
    selectedIndex = index;
    selectCurrent();
  }
});

// Click outside results — focus input
document.addEventListener('click', (e) => {
  if (!e.target.closest('.result-item') && !e.target.closest('.search-container')) {
    searchInput.focus();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await applyTheme();
  await loadData();
  searchInput.focus();
});
