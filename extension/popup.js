// TabTamer — Toolbar Popup
// T7.10: Lightweight popup for quick actions, group stats, and recent classifications

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const toggleSwitch = document.getElementById('toggle-switch');
const enabledStatus = document.getElementById('enabled-status');
const groupCount = document.getElementById('group-count');
const groupNamesContainer = document.getElementById('group-names-container');
const recentList = document.getElementById('recent-list');
const classifyBtn = document.getElementById('classify-btn');
const optionsLink = document.getElementById('options-link');
const refreshBtn = document.getElementById('refresh-btn');
const processingIndicator = document.getElementById('processing-indicator');
const processingText = document.getElementById('processing-text');
const errorState = document.getElementById('error-state');
const groupSearchInput = document.getElementById('group-search-input');

// T10.12: Startup scan progress elements
const startupProgress = document.getElementById('startup-progress');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');

// ─── State ────────────────────────────────────────────────────────────────────

let popupState = null;
let _groupSearchTerm = '';
let _groupSearchDebounce = null;

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Load Popup State ─────────────────────────────────────────────────────────

async function loadPopupState() {
  showLoading();

  try {
    const response = await browser.runtime.sendMessage({ type: 'getPopupState' });

    if (!response) {
      showError('Could not connect to background script');
      return;
    }

    popupState = response;
    renderState(response);
    hideError();
    hideLoading();
  } catch (err) {
    console.error('TabTamer popup: failed to load state', err);
    showError('Failed to load state. Try refreshing.');
  }
}

// ─── Render State ─────────────────────────────────────────────────────────────

function renderState(state) {
  // Toggle
  if (state.enabled) {
    toggleSwitch.classList.add('active');
    toggleSwitch.setAttribute('aria-checked', 'true');
    enabledStatus.textContent = 'Active';
    enabledStatus.style.color = 'var(--success)';
  } else {
    toggleSwitch.classList.remove('active');
    toggleSwitch.setAttribute('aria-checked', 'false');
    enabledStatus.textContent = 'Paused';
    enabledStatus.style.color = 'var(--text-muted)';
  }

  // Processing indicator
  if (state.processingCount > 0) {
    processingIndicator.classList.add('visible');
    processingText.textContent = `Classifying ${state.processingCount} tab${state.processingCount !== 1 ? 's' : ''}…`;
  } else {
    processingIndicator.classList.remove('visible');
  }

  // T10.12: Startup scan progress bar
  if (state.startupProgress && state.startupProgress.total > 0) {
    startupProgress.classList.add('visible');
    const pct = Math.round((state.startupProgress.processed / state.startupProgress.total) * 100);
    progressBarFill.style.width = `${pct}%`;
    progressText.textContent = `Startup scan: ${state.startupProgress.processed} / ${state.startupProgress.total} tabs`;
  } else {
    startupProgress.classList.remove('visible');
    progressBarFill.style.width = '0%';
  }

  // Group count
  groupCount.textContent = state.managedGroupCount;

  // Hibernated count
  if (state.hibernatedCount && state.hibernatedCount > 0) {
    document.getElementById('hibernated-row').style.display = 'flex';
    document.getElementById('hibernated-count').textContent = `${state.hibernatedCount} tab${state.hibernatedCount !== 1 ? 's' : ''}`;
  } else {
    document.getElementById('hibernated-row').style.display = 'none';
  }

  // T9.14: LLM Cost display
  if (state.totalCalls && state.totalCalls > 0) {
    document.getElementById('cost-row').style.display = 'flex';
    // Format cost with up to 4 decimal places, trim trailing zeros
    const formattedCost = state.totalCost.toFixed(4).replace(/\.?0+$/, '');
    document.getElementById('cost-value').textContent = `$${formattedCost} (${state.totalCalls} call${state.totalCalls !== 1 ? 's' : ''})`;

    // Show token counts (estimated + live)
    document.getElementById('tokens-row').style.display = 'flex';
    const est = state.totalEstimatedTokens || 0;
    const live = state.totalLiveTokens || 0;
    document.getElementById('tokens-value').textContent = live > 0 ? `~${est} est / ${live} live` : `~${est} estimated`;
  } else {
    document.getElementById('cost-row').style.display = 'none';
    document.getElementById('tokens-row').style.display = 'none';
  }

  // Group names with tab counts (T10.13: filter by search term)
  let displayGroups = state.managedGroupNames || [];
  if (_groupSearchTerm) {
    const term = _groupSearchTerm.toLowerCase();
    displayGroups = displayGroups.filter(name => name.toLowerCase().includes(term));
  }
  if (displayGroups.length > 0) {
    groupNamesContainer.innerHTML = displayGroups
      .map(name => {
        const count = (state.managedGroupTabCounts && state.managedGroupTabCounts[name]) || 0;
        const display = count > 0 ? `${escapeHtml(name)} (${count})` : escapeHtml(name);
        return `<span class="group-tag" title="${escapeHtml(name)}">${display}</span>`;
      })
      .join('');
  } else if (_groupSearchTerm) {
    groupNamesContainer.innerHTML = '<span class="group-list-empty">No groups match "' + escapeHtml(_groupSearchTerm) + '"</span>';
  } else {
    groupNamesContainer.innerHTML = '<span class="group-list-empty">No TabTamer-managed groups yet</span>';
  }

  // Recent classifications
  if (state.recentClassifications && state.recentClassifications.length > 0) {
    recentList.innerHTML = state.recentClassifications
      .map(item => {
        const domain = item.domain || 'unknown';
        const group = item.group || '?';
        const time = item.timestamp ? formatTime(item.timestamp) : '';
        return `<div class="recent-item">
          <span class="recent-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
          <span class="recent-group">${escapeHtml(group)}</span>
          ${time ? `<span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">${time}</span>` : ''}
        </div>`;
      })
      .join('');
  } else {
    recentList.innerHTML = '<span class="recent-empty">No recent classifications</span>';
  }
}

// ─── Toggle Pause/Resume ──────────────────────────────────────────────────────

async function handleToggle() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'togglePause' });

    if (response && response.enabled !== undefined) {
      // Optimistically update the UI
      if (popupState) {
        popupState.enabled = response.enabled;
        renderState(popupState);
      }
    } else {
      // If something went wrong, reload the full state
      await loadPopupState();
    }
  } catch (err) {
    console.error('TabTamer popup: toggle failed', err);
    await loadPopupState();
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showLoading() {
  // Show loading spinner, hide main content
  document.getElementById('loading-state').classList.add('visible');
  document.getElementById('loading-state').style.display = 'block';
  document.querySelector('.toggle-section').style.display = 'none';
  document.querySelector('.processing-indicator').style.display = 'none';
  document.querySelector('.startup-progress').style.display = 'none';
  document.querySelector('.stats-section').style.display = 'none';
  document.querySelector('.group-list').style.display = 'none';
  document.querySelector('.recent-section').style.display = 'none';
  document.querySelector('.footer').style.display = 'none';
  errorState.style.display = 'none';
}

function hideLoading() {
  // Hide loading spinner, show main content
  document.getElementById('loading-state').classList.remove('visible');
  document.getElementById('loading-state').style.display = 'none';
  document.querySelector('.toggle-section').style.display = '';
  document.querySelector('.stats-section').style.display = '';
  // The startup progress visibility is handled by renderState
  document.querySelector('.group-list').style.display = '';
  document.querySelector('.recent-section').style.display = '';
  document.querySelector('.footer').style.display = '';
  // The processing indicator visibility is handled by renderState
}

function showError(message) {
  hideLoading();
  errorState.textContent = message;
  errorState.style.display = 'block';
}

function hideError() {
  errorState.style.display = 'none';
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// ─── Group Search (T10.13) ──────────────────────────────────────

if (groupSearchInput) {
  groupSearchInput.addEventListener('input', () => {
    _groupSearchTerm = groupSearchInput.value.trim();
    if (_groupSearchDebounce) clearTimeout(_groupSearchDebounce);
    _groupSearchDebounce = setTimeout(() => {
      if (popupState) renderState(popupState);
    }, 150);
  });
}

toggleSwitch.addEventListener('click', handleToggle);
toggleSwitch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleToggle();
  }
});

// ─── Classify Active Tab ───────────────────────────────────────────────────

// T10.14: Update classify button text with current tab info
async function updateClassifyBtnText() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    const tab = tabs[0];
    const label = tab.title || tab.url || '';
    const truncated = label.length > 30 ? label.substring(0, 27) + '...' : label;
    classifyBtn.textContent = `Classify ${truncated}`;
    classifyBtn.title = `Classify ${tab.url || tab.title || 'current tab'}`;
  } catch (err) {
    // Fall back to default text
    classifyBtn.textContent = 'Classify Tab';
  }
}

async function handleClassifyNow() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    const tab = tabs[0];
    // T11.11: Show 'Classifying…' state and await result
    classifyBtn.textContent = 'Classifying…';
    classifyBtn.disabled = true;
    hideError();

    await browser.runtime.sendMessage({
      type: 'classifyNow',
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    });

    // T11.11: Success — show green checkmark, then close
    classifyBtn.textContent = '\u2713 Done!';
    classifyBtn.style.color = 'var(--success)';
    classifyBtn.style.borderColor = 'var(--success)';
    await new Promise(resolve => setTimeout(resolve, 1500));
    window.close();
  } catch (err) {
    console.error('TabTamer popup: classify failed', err);
    // T11.11: Failure — keep popup open, show error message
    classifyBtn.textContent = 'Classify Tab';
    classifyBtn.disabled = false;
    classifyBtn.style.color = '';
    classifyBtn.style.borderColor = '';
    showError(`Classification failed: ${err.message || 'Unknown error'}`);
  }
}

classifyBtn.addEventListener('click', handleClassifyNow);

refreshBtn.addEventListener('click', loadPopupState);

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close(); // Close the popup after opening options
});

// ─── Platform-aware shortcut display ────────────────────────────
// T11.10: Show correct modifier key (Cmd on Mac, Ctrl elsewhere)
function updateShortcutHint() {
  const hint = document.querySelector('.footer-hint');
  if (!hint) return;
  const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac OS');
  const modifier = isMac ? 'Cmd' : 'Ctrl';
  hint.innerHTML = `Press <kbd>${modifier}+Shift+E</kbd> to open popup`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // T8.8: Load user theme setting from storage
  try {
    const result = await browser.storage.local.get('tabtamerSettings');
    const theme = result.tabtamerSettings?.theme || 'system';
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (err) {
    // Default to system preference
    document.documentElement.removeAttribute('data-theme');
  }

  updateShortcutHint();
  await loadPopupState();
  await updateClassifyBtnText();
});

// T10.12: Listen for live startup scan progress updates from background
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'startupProgress') {
    if (message.total > 0) {
      startupProgress.classList.add('visible');
      const pct = Math.round((message.processed / message.total) * 100);
      progressBarFill.style.width = `${pct}%`;
      progressText.textContent = `Startup scan: ${message.processed} / ${message.total} tabs`;
    } else {
      startupProgress.classList.remove('visible');
      progressBarFill.style.width = '0%';
    }
    // Update popupState if available so render consistency is maintained
    if (popupState) {
      popupState.startupProgress = { processed: message.processed, total: message.total };
    }
  }
});
