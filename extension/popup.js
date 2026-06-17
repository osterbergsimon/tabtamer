// TabTamer — Toolbar Popup
// T7.10: Lightweight popup for quick actions, group stats, and recent classifications

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const toggleSwitch = document.getElementById('toggle-switch');
const enabledStatus = document.getElementById('enabled-status');
const groupCount = document.getElementById('group-count');
const groupNamesContainer = document.getElementById('group-names-container');
const recentList = document.getElementById('recent-list');
const optionsLink = document.getElementById('options-link');
const refreshBtn = document.getElementById('refresh-btn');
const processingIndicator = document.getElementById('processing-indicator');
const processingText = document.getElementById('processing-text');
const errorState = document.getElementById('error-state');

// ─── State ────────────────────────────────────────────────────────────────────

let popupState = null;

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

  // Group count
  groupCount.textContent = state.managedGroupCount;

  // Group names
  if (state.managedGroupNames && state.managedGroupNames.length > 0) {
    groupNamesContainer.innerHTML = state.managedGroupNames
      .map(name => `<span class="group-tag">${escapeHtml(name)}</span>`)
      .join('');
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
  // We keep existing content but show a subtle loading state
}

function showError(message) {
  errorState.textContent = message;
  errorState.style.display = 'block';
}

function hideError() {
  errorState.style.display = 'none';
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

toggleSwitch.addEventListener('click', handleToggle);
toggleSwitch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleToggle();
  }
});

refreshBtn.addEventListener('click', loadPopupState);

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close(); // Close the popup after opening options
});

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', loadPopupState);
