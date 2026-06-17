// TabTamer — Options page logic
// TAS-8: Load settings, save on submit, clear cache

// ─── Constants are defined in lib/constants.js (loaded first via <script>) ────

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const form = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key');
const providerPresetSelect = document.getElementById('provider-preset');
const customEndpointInput = document.getElementById('custom-endpoint');
const endpointField = document.getElementById('endpoint-field');
const modelInput = document.getElementById('model');
const modelHint = document.getElementById('model-hint');
const costPerMillionInput = document.getElementById('cost-per-million');
const fetchPricingBtn = document.getElementById('fetch-pricing-btn');
const themeSelect = document.getElementById('theme');
const enabledCheckbox = document.getElementById('enabled');
const batchClusteringCheckbox = document.getElementById('batch-clustering');
const saveBtn = document.getElementById('save-btn');
const resetDefaultsBtn = document.getElementById('reset-defaults-btn');

// ─── Default settings values (T11.14) ────────────────────────────────────────

const DEFAULTS = {
  apiKey: '',
  providerPreset: DEFAULT_PROVIDER,
  customEndpoint: '',
  model: '',
  costPerMillionTokens: 1.00,
  theme: 'system',
  enabled: true,
  batchClusteringEnabled: true,
  hibernateAfterMinutes: '30',
};
const testApiKeyBtn = document.getElementById('test-api-key-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const exportCacheBtn = document.getElementById('export-cache-btn');
const importCacheBtn = document.getElementById('import-cache-btn');
const cacheFileInput = document.getElementById('cache-file-input');
const cacheStats = document.getElementById('cache-stats');
const resetCostsBtn = document.getElementById('reset-costs-btn');
const costCalls = document.getElementById('cost-calls');
const costTokens = document.getElementById('cost-tokens');
const costLiveTokens = document.getElementById('cost-live-tokens');
const toast = document.getElementById('toast');

// ─── Suggest Rules DOM refs (T10.9) ──────────────────────────────────────────

const suggestRulesBtn = document.getElementById('suggest-rules-btn');
const suggestModal = document.getElementById('suggest-modal');
const suggestModalLoading = document.getElementById('suggest-modal-loading');
const suggestModalError = document.getElementById('suggest-modal-error');
const suggestModalResults = document.getElementById('suggest-modal-results');
const suggestTableBody = document.getElementById('suggest-table-body');
const suggestSelectAll = document.getElementById('suggest-select-all');
const suggestApproveBtn = document.getElementById('suggest-approve-btn');
const suggestDismissBtn = document.getElementById('suggest-dismiss-btn');
const suggestModalCount = document.getElementById('suggest-modal-count');

// ─── Excluded Domains DOM refs (T6.9) ──────────────────────────────────────────

const excludedDomainsInput = document.getElementById('excluded-domains-input');
const saveExcludedDomainsBtn = document.getElementById('save-excluded-domains-btn');

// ─── Cache Dashboard DOM refs ────────────────────────────────────────────────

const cacheSearch = document.getElementById('cache-search');
const cacheTable = document.getElementById('cache-table');
const cacheTableBody = document.getElementById('cache-table-body');
const cacheEmptyMessage = document.getElementById('cache-empty-message');
const dashboardCacheCount = document.getElementById('dashboard-cache-count');

// ─── Tab Hibernation DOM refs (T9.19) ──────────────────────────────────────

const hibernateAfterSelect = document.getElementById('hibernate-after');

// ─── Unsaved Changes Warning (T9.17) ────────────────────────────────

// ─── Cache Undo Stack (T10.11) ──────────────────────────────
// Stack of { action, domain, groupName } entries for cache edit/delete undo
// Max 10 entries. Auto-clears after 10 seconds.

let _cacheUndoStack = [];
const MAX_UNDO_DEPTH = 10;
const UNDO_TOAST_DURATION_MS = 10000;

let _isDirty = false;

function _markDirty() {
  if (!_isDirty) {
    _isDirty = true;
    console.log('TabTamer: unsaved changes detected');
  }
}

function _markClean() {
  if (_isDirty) {
    _isDirty = false;
    console.log('TabTamer: unsaved changes cleared');
  }
}

// ─── Group Colors Cache ────────────────────────────────────────────
// T8.11: Load custom group colors for color picker rendering

let _groupColors = {};

const GROUP_COLOR_NAMES = ['grey', 'blue', 'red', 'yellow', 'purple', 'pink', 'green', 'orange', 'cyan'];

async function loadGroupColors() {
  try {
    const result = await browser.storage.local.get(GROUP_COLORS_KEY);
    _groupColors = result[GROUP_COLORS_KEY] || {};
  } catch (err) {
    console.error('TabTamer: failed to load group colors', err);
    _groupColors = {};
  }
}

async function saveGroupColors() {
  try {
    await browser.storage.local.set({ [GROUP_COLORS_KEY]: _groupColors });
  } catch (err) {
    console.error('TabTamer: failed to save group colors', err);
  }
}

// ─── Loading state helper ────────────────────────────────────────────────────

function setButtonLoading(button, isLoading, loadingText) {
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
    button.classList.add('loading');
  } else {
    button.disabled = false;
    button.classList.remove('loading');
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
  }
}

// ─── Theme helper ───────────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// ─── Color helper (T8.11) ───────────────────────────────────────────
// Map color name to a CSS color for inline swatch rendering

function getColorCss(colorName) {
  const colorMap = {
    grey: '#a09f9b',
    blue: '#4a86e8',
    red: '#ff3b30',
    yellow: '#ff9f0a',
    purple: '#bf5af2',
    pink: '#ff6488',
    green: '#34c759',
    orange: '#ff9500',
    cyan: '#64d2ff'
  };
  return colorMap[colorName] || '#a09f9b';
}

// ─── Toast helper ─────────────────────────────────────────────────────────────

function showToast(message, type = 'success', duration, onClick) {
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;
  toast.setAttribute('role', 'alert');

  // Clear previous click handler
  toast.onclick = null;
  toast.style.cursor = onClick ? 'pointer' : '';

  if (onClick) {
    toast.onclick = function() {
      onClick();
      toast.classList.remove('show');
      toast.onclick = null;
      toast.style.cursor = '';
      toast.setAttribute('role', 'presentation');
      if (window._toastTimer) {
        clearTimeout(window._toastTimer);
        window._toastTimer = null;
      }
    };
  }

  // Auto-dismiss after configurable duration (default 3000ms, import results 5000ms)
  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.onclick = null;
    toast.style.cursor = '';
    toast.setAttribute('role', 'presentation');
  }, duration || TOAST_DURATION_MS);
}

// ─── Confirm Modal (T7.11) ───────────────────────────────────────────
// Replaces blocking confirm() with an inline modal overlay.
// Returns a Promise that resolves to true (OK) or false (Cancel).

function showConfirmModal(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (!modal || !messageEl || !okBtn || !cancelBtn) {
      // Fallback: if modal elements are missing, resolve to false silently
      resolve(false);
      return;
    }

    messageEl.textContent = message;
    modal.style.display = 'flex';

    function cleanup() {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
      modal.removeEventListener('click', onOverlayClick);
    }

    function onOk() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    function onKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onOk();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }

    function onOverlayClick(e) {
      // Close if the overlay background (not the dialog) is clicked
      if (e.target === modal) {
        onCancel();
      }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
    modal.addEventListener('click', onOverlayClick);

    // Focus the cancel button by default (safer default action)
    cancelBtn.focus();
  });
}

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || {};

    apiKeyInput.value = settings.apiKey || '';
    providerPresetSelect.value = settings.providerPreset || DEFAULT_PROVIDER;
    customEndpointInput.value = settings.customEndpoint || '';
    modelInput.value = settings.model || '';
    costPerMillionInput.value = settings.costPerMillionTokens != null ? String(settings.costPerMillionTokens) : '1.00';
    themeSelect.value = settings.theme || 'system';
    enabledCheckbox.checked = settings.enabled !== false; // default enabled
    batchClusteringCheckbox.checked = settings.batchClusteringEnabled !== false; // default enabled
    hibernateAfterSelect.value = settings.hibernateAfterMinutes != null ? String(settings.hibernateAfterMinutes) : '30';
    applyTheme(themeSelect.value);
    
    // Show/hide endpoint field and update model hint based on preset
    onProviderPresetChange();
  } catch (err) {
    console.error('TabTamer: failed to load settings', err);
    showToast('Failed to load settings', 'error');
  }
}

// Handle provider preset change: show/hide endpoint field, update model hint
function onProviderPresetChange() {
  const preset = providerPresetSelect.value;
  
  // Show endpoint field only for 'custom' preset
  endpointField.style.display = preset === 'custom' ? 'block' : 'none';
  
  // Update model hint
  if (preset === 'custom') {
    modelHint.textContent = 'Enter your model name for the custom endpoint.';
  } else {
    const presetData = PROVIDER_PRESETS[preset];
    if (presetData) {
      const defaultModel = modelInput.value || presetData.defaultModel;
      modelInput.placeholder = presetData.defaultModel;
      // If model input is empty, suggest the default
      if (!modelInput.value) {
        modelInput.placeholder = presetData.defaultModel;
      }
      modelHint.textContent = `Default: ${presetData.defaultModel} — ~$${presetData.costPerMillion}/M tokens`;
      
      // Auto-fill cost per million if user hasn't set it
      const currentCost = parseFloat(costPerMillionInput.value);
      if (isNaN(currentCost) || currentCost === 1.0) {
        // Only auto-fill if it's still the default value
        costPerMillionInput.value = String(presetData.costPerMillion);
      }
    }
  }
}

// ─── Save settings ────────────────────────────────────────────────────────────

async function saveSettings(e) {
  e.preventDefault();

  setButtonLoading(saveBtn, true, 'Saving…');

  const apiKey = apiKeyInput.value.trim();
  const providerPreset = providerPresetSelect.value;
  const customEndpoint = customEndpointInput.value.trim();
  const model = modelInput.value.trim();
  const costPerMillionTokens = parseFloat(costPerMillionInput.value) || 0;
  const theme = themeSelect.value;
  const enabled = enabledCheckbox.checked;
  const batchClusteringEnabled = batchClusteringCheckbox.checked;

  // ─── Validation ────────────────────────────────────────────────

  // If API key is provided, it must start with "sk-"
  if (apiKey && !/^sk-/.test(apiKey)) {
    setButtonLoading(saveBtn, false);
    showToast('API key should start with sk-', 'error');
    return;
  }

  // If custom preset, endpoint is required
  if (providerPreset === 'custom' && !customEndpoint) {
    setButtonLoading(saveBtn, false);
    showToast('Custom endpoint URL is required', 'error');
    return;
  }

  // If auto-grouping is enabled but no API key is set, warn but allow save
  let showedWarning = false;
  if (enabled && !apiKey && providerPreset !== 'ollama') {
    showToast('Auto-grouping requires an API key', 'warning');
    showedWarning = true;
    // Continue saving despite the warning
  }

  // ─── Save ──────────────────────────────────────────────────────

  const settings = {
    apiKey,
    providerPreset,
    customEndpoint,
    model,
    costPerMillionTokens,
    theme,
    enabled,
    batchClusteringEnabled,
    hibernateAfterMinutes: hibernateAfterSelect.value === 'never' ? 'never' : parseInt(hibernateAfterSelect.value, 10),
  };

  try {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });

    // If API key is set, clear the "no API key" notification flag so the user
    // gets reminded again if they later clear the key
    if (settings.apiKey) {
      await browser.storage.local.remove(NO_API_KEY_NOTIFIED_KEY);
    }

    _markClean();

    // Only show success toast if no warning was shown (toast already shown)
    if (!showedWarning) {
      showToast('Settings saved successfully');
    }
  } catch (err) {
    console.error('TabTamer: failed to save settings', err);
    showToast('Failed to save settings', 'error');
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

// ─── Cache stats ──────────────────────────────────────────────────────────────

async function loadCacheStats() {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    const count = Object.keys(cache).length;
    cacheStats.textContent = count === 1 ? '1 domain cached' : `${count} domains cached`;
  } catch (err) {
    console.error('TabTamer: failed to read cache stats', err);
    cacheStats.textContent = 'Could not load cache stats';
  }
}

// T10.15: Format a timestamp for display
function _formatTimestamp(ts) {
  if (!ts) return 'Unknown';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

// ─── Cache Dashboard ─────────────────────────────────────────────────────────
// T5.9: Searchable, filterable table of cached domains and groups with edit/delete

async function loadCacheDashboard() {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    // T10.15: Normalize entries to { group, timestamp } format
    const entries = Object.entries(cache).map(([domain, value]) => [
      domain,
      { group: _getCacheGroupName(value) || '', timestamp: _getCacheTimestamp(value) }
    ]);
    const searchTerm = cacheSearch.value.trim().toLowerCase();

    // Load hibernation opt-out list for per-group checkbox display
    let hibernateOptOut = [];
    try {
      const optResult = await browser.storage.local.get(HIBERNATE_OPT_OUT_KEY);
      hibernateOptOut = optResult[HIBERNATE_OPT_OUT_KEY] || [];
    } catch (optErr) {
      console.warn('TabTamer: failed to load hibernation opt-out list', optErr);
    }

    // Update entry count
    dashboardCacheCount.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

    // Filter by search term
    const filtered = searchTerm
      ? entries.filter(([domain, info]) =>
          domain.toLowerCase().includes(searchTerm) ||
          info.group.toLowerCase().includes(searchTerm)
        )
      : entries;

    if (entries.length === 0) {
      cacheTable.style.display = 'none';
      cacheEmptyMessage.style.display = 'block';
      cacheTableBody.innerHTML = '';
      return;
    }

    // Show table, hide empty message
    cacheTable.style.display = 'table';
    cacheEmptyMessage.style.display = 'none';

    if (filtered.length === 0) {
      // No results match the search
      cacheTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No matching entries</td></tr>`;
      return;
    }

    // Build table rows
    const rows = filtered.map(([domain, info]) => {
      const escapedDomain = domain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escapedGroup = info.group.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const timestampStr = _formatTimestamp(info.timestamp);
      const currentColor = _groupColors[info.group] || '';
      const colorOptions = GROUP_COLOR_NAMES.map(c => {
        const selected = c === currentColor ? 'selected' : '';
        const swatchBg = getColorCss(c);
        return `<option value="${c}" ${selected} style="background-color: ${swatchBg};">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`;
      }).join('');
      const colorPicker = `<select class="color-picker" data-group-name="${escapedGroup}" aria-label="Color for ${escapedDomain}" style="font-size: 11px; padding: 2px 4px; width: 90px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
        <option value="" ${currentColor === '' ? 'selected' : ''}>Auto</option>
        ${colorOptions}
      </select>`;
      const noHibernateChecked = hibernateOptOut.includes(escapedGroup) ? 'checked' : '';
      return `<tr data-domain="${escapedDomain}" data-group="${escapedGroup}">
        <td style="padding: 6px 8px; overflow-wrap: break-word;" class="cache-domain-cell">${escapedDomain}</td>
        <td style="padding: 6px 8px; word-break: break-all;" class="cache-group-cell">
          <span class="cache-group-text">${escapedGroup}</span>
          <input type="text" class="cache-group-edit" value="${escapedGroup}"
                 style="display:none; width: 90%; padding: 4px 6px; font-size: 12px;
                        background: var(--bg); border: 1px solid var(--primary);
                        border-radius: 4px; color: var(--text);">
        </td>
        <td style="padding: 6px 8px; text-align: center; vertical-align: middle; font-size: 12px; color: var(--text-muted); white-space: nowrap;">${timestampStr}</td>
        <td style="padding: 6px 8px; text-align: center; vertical-align: middle;">${colorPicker}</td>
        <td style="padding: 6px 8px; text-align: center; vertical-align: middle;">
          <input type="checkbox" class="no-hibernate-checkbox" ${noHibernateChecked}
                 style="accent-color: var(--primary); cursor: pointer;">
        </td>
        <td style="padding: 6px 8px; text-align: right; white-space: nowrap;">
          <button class="btn-cache-action btn-cache-edit" data-action="edit">Edit</button>
          <button class="btn-cache-action btn-cache-save" data-action="save" style="display:none;">Save</button>
          <button class="btn-cache-action btn-cache-cancel" data-action="cancel" style="display:none;">Cancel</button>
          <button class="btn-cache-action btn-cache-delete" data-action="delete">Delete</button>
        </td>
      </tr>`;
    }).join('');

    cacheTableBody.innerHTML = rows;
  } catch (err) {
    console.error('TabTamer: failed to load cache dashboard', err);
    cacheTable.style.display = 'none';
    cacheEmptyMessage.textContent = 'Could not load cache data';
    cacheEmptyMessage.style.display = 'block';
  }
}

// ─── T10.9: Suggest Rules from Cache ────────────────────────────────────────

let _suggestions = []; // Current suggestion list for approve/dismiss

async function handleSuggestRules() {
  // Show the modal with loading state
  suggestModal.style.display = 'flex';
  suggestModalLoading.style.display = 'block';
  suggestModalError.style.display = 'none';
  suggestModalResults.style.display = 'none';
  suggestTableBody.innerHTML = '';

  try {
    const response = await browser.runtime.sendMessage({ type: 'suggestRules' });

    if (!response || !response.success) {
      const errMsg = response?.error || 'Failed to get suggestions from background script.';
      showSuggestError(errMsg);
      return;
    }

    const suggestions = response.suggestions;

    if (!suggestions || suggestions.length === 0) {
      showSuggestError('No clear patterns found in cache. Try adding more domain→group mappings first.');
      return;
    }

    _suggestions = suggestions;
    renderSuggestions(suggestions);
  } catch (err) {
    console.error('TabTamer: suggest rules error', err);
    showSuggestError('Connection error. Could not reach the background script.');
  }
}

function showSuggestError(message) {
  suggestModalLoading.style.display = 'none';
  suggestModalResults.style.display = 'none';
  suggestModalError.textContent = message;
  suggestModalError.style.display = 'block';
}

function renderSuggestions(suggestions) {
  suggestModalLoading.style.display = 'none';
  suggestModalError.style.display = 'none';
  suggestModalResults.style.display = 'block';

  const rows = suggestions.map((s, i) => {
    const escapedPattern = (s.pattern || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedGroup = (s.groupName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedReason = (s.reason || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const confidencePct = Math.round((s.confidence || 0) * 100);
    const confidenceColor = confidencePct >= 70 ? 'var(--success)' : confidencePct >= 40 ? '#ff9f0a' : 'var(--text-muted)';
    return `<tr data-index="${i}">
      <td style="text-align: center; padding: 8px;">
        <input type="checkbox" class="suggest-checkbox" data-index="${i}" checked style="accent-color: var(--primary); cursor: pointer;">
      </td>
      <td style="padding: 8px; word-break: break-all;"><code style="background: var(--bg); padding: 1px 4px; border-radius: 3px; font-size: 12px;">${escapedPattern}</code></td>
      <td style="padding: 8px;">${escapedGroup}</td>
      <td style="text-align: center; padding: 8px; font-weight: 600; color: ${confidenceColor};">${confidencePct}%</td>
      <td style="padding: 8px; font-size: 12px; color: var(--text-muted);">${escapedReason}</td>
    </tr>`;
  }).join('');

  suggestTableBody.innerHTML = rows;
  suggestSelectAll.checked = true;
  suggestModalCount.textContent = `${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''} found`;
}

async function approveSelectedSuggestions() {
  const checkboxes = document.querySelectorAll('.suggest-checkbox:checked');
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10)).filter(i => !isNaN(i));

  if (indices.length === 0) {
    showToast('No suggestions selected', 'warning');
    return;
  }

  let approved = 0;
  let errors = [];

  for (const idx of indices) {
    if (idx >= 0 && idx < _suggestions.length) {
      try {
        const result = await browser.runtime.sendMessage({
          type: 'approveSuggestedRule',
          rule: _suggestions[idx]
        });
        if (result && result.success) {
          approved++;
        } else {
          errors.push(`${_suggestions[idx].pattern} → ${_suggestions[idx].groupName}: ${result?.error || 'Unknown error'}`);
        }
      } catch (err) {
        errors.push(`${_suggestions[idx].pattern}: ${err.message}`);
      }
    }
  }

  // Close the modal
  suggestModal.style.display = 'none';

  if (approved > 0) {
    showToast(`Approved ${approved} rule${approved !== 1 ? 's' : ''}`, 'success');
    // Reload the rules table so the user sees their new rules
    await loadRulesTable();
  }

  if (errors.length > 0) {
    console.warn('TabTamer: suggestion approval errors', errors);
    showToast(`${errors.length} suggestion${errors.length !== 1 ? 's' : ''} failed to save`, 'error');
  }
}

function dismissSuggestions() {
  _suggestions = [];
  suggestModal.style.display = 'none';
  showToast('Suggestions dismissed', 'warning');
}

// ─── Cache Dashboard Event Handling ──────────────────────────────────────────
// T5.9: Handle edit, save, cancel, and delete actions on cache rows

function setupCacheDashboardEvents() {
  cacheTableBody.addEventListener('click', async (event) => {
    const button = event.target.closest('.btn-cache-action');
    if (!button) return;

    const row = button.closest('tr');
    if (!row) return;

    const domain = row.dataset.domain;
    const action = button.dataset.action;

    if (action === 'edit') {
      // Enter edit mode: show input, hide text, show save/cancel, hide edit/delete
      row.querySelector('.cache-group-text').style.display = 'none';
      row.querySelector('.cache-group-edit').style.display = 'inline-block';
      row.querySelector('.btn-cache-edit').style.display = 'none';
      row.querySelector('.btn-cache-delete').style.display = 'none';
      row.querySelector('.btn-cache-save').style.display = 'inline-block';
      row.querySelector('.btn-cache-cancel').style.display = 'inline-block';
      // Focus and select the input
      const input = row.querySelector('.cache-group-edit');
      input.focus();
      input.select();
    } else if (action === 'save') {
      // Save the edited group name
      const input = row.querySelector('.cache-group-edit');
      const newGroup = input.value.trim();
      if (!newGroup) {
        // Revert if empty
        input.value = row.dataset.group;
        return;
      }

      const oldGroup = row.dataset.group;

      // T10.11: Save to undo stack before editing (skip if no change)
      if (oldGroup !== newGroup) {
        _cacheUndoStack.push({ action: 'edit', domain, previousGroupName: oldGroup, groupName: newGroup });
        if (_cacheUndoStack.length > MAX_UNDO_DEPTH) _cacheUndoStack.shift();
      }

      try {
        const { conflict } = await updateCacheEntry(domain, newGroup);
        if (conflict) {
          console.warn(`TabTamer: resolved conflict for "${domain}" — saved user edit`);
        }

        // Update the row data
        row.dataset.group = newGroup;
        row.querySelector('.cache-group-text').textContent = newGroup;
        if (oldGroup !== newGroup) {
          showToast(`Updated "${domain}" — Undo`, 'warning', UNDO_TOAST_DURATION_MS, () => performCacheUndo());
        } else {
          showToast(`No change for "${domain}"`, 'success');
        }

        // If the group name changed, offer to move tabs from old group to new group
        if (oldGroup !== newGroup) {
          try {
            const oldGroups = await browser.tabGroups.query({ title: oldGroup });
            if (oldGroups.length > 0 && oldGroups[0].id) {
              const moveTabs = await showConfirmModal(
                `Group name changed from "${oldGroup}" to "${newGroup}".\n\n` +
                `Move existing tabs from "${oldGroup}" to "${newGroup}"?`
              );
              if (moveTabs) {
                // Find or create the new group
                const newGroups = await browser.tabGroups.query({ title: newGroup });
                let targetGroupId;
                if (newGroups.length > 0) {
                  targetGroupId = newGroups[0].id;
                } else {
                  // Need a window to create the group — use the first window
                  const windows = await browser.windows.getAll({ populate: false });
                  if (windows.length > 0) {
                    const newGroupObj = await browser.tabGroups.create({
                      title: newGroup,
                      windowId: windows[0].id
                    });
                    targetGroupId = newGroupObj.id;
                  }
                }

                if (targetGroupId) {
                  const tabsInOldGroup = await browser.tabs.query({ groupId: oldGroups[0].id });
                  const tabIds = tabsInOldGroup.map(t => t.id);
                  if (tabIds.length > 0) {
                    await browser.tabs.group({ tabIds, groupId: targetGroupId });
                    showToast(`Moved ${tabIds.length} tab(s) from "${oldGroup}" to "${newGroup}"`, 'success');
                  }
                }
              }
            }
          } catch (moveErr) {
            console.error('TabTamer: failed to move tabs after cache edit', moveErr);
            // Non-fatal — cache was already updated
          }
        }
      } catch (err) {
        console.error('TabTamer: failed to update cache entry', err);
        showToast('Failed to update cache entry', 'error');
      }

      // T8.11: Migrate custom color when group is renamed
      if (oldGroup !== newGroup && oldGroup in _groupColors) {
        _groupColors[newGroup] = _groupColors[oldGroup];
        delete _groupColors[oldGroup];
        await saveGroupColors();
        console.log(`TabTamer: migrated custom color from "${oldGroup}" to "${newGroup}"`);
      }

      // Exit edit mode
      exitEditMode(row, domain);
      loadCacheDashboard(); // Refresh to keep state consistent
    } else if (action === 'cancel') {
      // Exit edit mode without saving
      exitEditMode(row, domain);
    } else if (action === 'delete') {
      // Confirm and delete
      const confirmed = await showConfirmModal(`Remove "${domain}" from the cache? The next visit will trigger a fresh LLM classification.`);
      if (!confirmed) return;

      // T10.11: Save to undo stack before deleting
      const deletedGroup = row.dataset.group;
      _cacheUndoStack.push({ action: 'delete', domain, groupName: deletedGroup });
      if (_cacheUndoStack.length > MAX_UNDO_DEPTH) _cacheUndoStack.shift();

      try {
        await updateCacheEntry(domain, null);
        showToast(`Removed "${domain}" — Undo`, 'warning', UNDO_TOAST_DURATION_MS, () => performCacheUndo());
      } catch (err) {
        console.error('TabTamer: failed to delete cache entry', err);
        showToast('Failed to delete cache entry', 'error');
      }

      loadCacheDashboard();
      loadCacheStats();
    }
  });

  // Search input: debounced filtering
  cacheSearch.addEventListener('input', () => {
    // Simple debounce via setTimeout
    if (cacheSearch._debounceTimer) {
      clearTimeout(cacheSearch._debounceTimer);
    }
    cacheSearch._debounceTimer = setTimeout(() => {
      loadCacheDashboard();
    }, 200);
  });

  // T8.11: Color picker change handler
  cacheTableBody.addEventListener('change', async (event) => {
    const select = event.target.closest('.color-picker');
    if (select) {
      const row = select.closest('tr');
      if (!row) return;

      const groupName = row.dataset.group;
      const color = select.value;

      if (color) {
        _groupColors[groupName] = color;
      } else {
        delete _groupColors[groupName];
      }

      await saveGroupColors();
      const colorLabel = color ? color : 'auto (deterministic)';
      showToast(`Color for "${groupName}" set to ${colorLabel}`, 'success');
      return;
    }

    // T9.19: No Hibernate checkbox change handler
    const checkbox = event.target.closest('.no-hibernate-checkbox');
    if (checkbox) {
      const row = checkbox.closest('tr');
      if (!row) return;

      const groupName = row.dataset.group;
      try {
        const optResult = await browser.storage.local.get(HIBERNATE_OPT_OUT_KEY);
        const optOut = optResult[HIBERNATE_OPT_OUT_KEY] || [];

        if (checkbox.checked) {
          if (!optOut.includes(groupName)) {
            optOut.push(groupName);
          }
        } else {
          const idx = optOut.indexOf(groupName);
          if (idx !== -1) {
            optOut.splice(idx, 1);
          }
        }

        await browser.storage.local.set({ [HIBERNATE_OPT_OUT_KEY]: optOut });
        showToast(
          checkbox.checked
            ? `Hibernation disabled for "${groupName}"`
            : `Hibernation enabled for "${groupName}"`,
          'success'
        );
      } catch (err) {
        console.error('TabTamer: failed to update hibernation opt-out', err);
        showToast('Failed to update hibernation opt-out', 'error');
        // Revert checkbox
        checkbox.checked = !checkbox.checked;
      }
    }
  });
}

function exitEditMode(row, domain) {
  const input = row.querySelector('.cache-group-edit');
  // Restore original value
  input.value = row.dataset.group;
  // Hide input, show text
  row.querySelector('.cache-group-text').style.display = 'inline';
  input.style.display = 'none';
  // Restore button visibility
  row.querySelector('.btn-cache-edit').style.display = 'inline-block';
  row.querySelector('.btn-cache-delete').style.display = 'inline-block';
  row.querySelector('.btn-cache-save').style.display = 'none';
  row.querySelector('.btn-cache-cancel').style.display = 'none';
}

// ─── Cache Undo (T10.11) ────────────────────────────────────────────

async function performCacheUndo() {
  const entry = _cacheUndoStack.pop();
  if (!entry) {
    showToast('Nothing to undo', 'warning');
    return;
  }

  try {
    if (entry.action === 'delete') {
      // Restore the deleted cache entry
      await updateCacheEntry(entry.domain, entry.groupName);
      showToast(`Undo: restored "${entry.domain}" → "${entry.groupName}"`, 'success');
    } else if (entry.action === 'edit') {
      // Revert to the previous group name
      await updateCacheEntry(entry.domain, entry.previousGroupName);
      showToast(`Undo: reverted "${entry.domain}" to "${entry.previousGroupName}"`, 'success');
    }
    loadCacheDashboard();
    loadCacheStats();
  } catch (err) {
    console.error('TabTamer: undo failed', err);
    showToast('Undo failed — the cache may have been modified', 'error');
  }
}

// ─── Atomic Cache Update (T6.4) ─────────────────────────────────────────────
// Re-read-before-write pattern with conflict detection to minimize the race
// window between options page edits and background script classifications.

async function updateCacheEntry(domain, newGroup) {
  // First read
  const result1 = await browser.storage.local.get(CACHE_KEY);
  const cache1 = result1[CACHE_KEY] || {};
  const originalEntry = cache1[domain] || null;
  const originalValue = _getCacheGroupName(originalEntry);

  // Immediate re-read before write to detect concurrent modifications
  const result2 = await browser.storage.local.get(CACHE_KEY);
  const cache2 = result2[CACHE_KEY] || {};
  const currentEntry = cache2[domain] || null;
  const currentValue = _getCacheGroupName(currentEntry);

  let conflict = false;
  if (currentValue !== originalValue) {
    console.warn(
      `TabTamer: cache conflict for "${domain}" — value changed from "${originalValue}" to "${currentValue}" during edit; merging with user's edit`
    );
    conflict = true;
  }

  // Apply the user's edit to the freshest data
  if (newGroup === null) {
    delete cache2[domain];
  } else {
    // Preserve existing timestamp or set a new one
    const existingTs = _getCacheTimestamp(currentEntry);
    cache2[domain] = { group: newGroup, timestamp: existingTs || Date.now() };
  }

  await browser.storage.local.set({ [CACHE_KEY]: cache2 });
  return { conflict };
}

// ─── Export cache ────────────────────────────────────────────────────────────
// T5.7: Download domainGroupCache as a JSON file

async function exportCache() {
  setButtonLoading(exportCacheBtn, true, 'Exporting…');
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    const json = JSON.stringify(cache, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `tabtamer-cache-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const count = Object.keys(cache).length;
    showToast(`Exported ${count} cache entr${count === 1 ? 'y' : 'ies'}`, 'success');
  } catch (err) {
    console.error('TabTamer: failed to export cache', err);
    showToast('Failed to export cache', 'error');
  } finally {
    setButtonLoading(exportCacheBtn, false);
  }
}

// ─── Import cache ────────────────────────────────────────────────────────────
// T5.7: Read a JSON file, validate structure, merge or overwrite cache

async function handleCacheFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  setButtonLoading(importCacheBtn, true, 'Importing…');

  try {
    const text = await file.text();
    let imported;
    try {
      imported = JSON.parse(text);
    } catch {
      showToast('Invalid JSON file', 'error');
      return;
    }

    // Validate structure: must be a plain object
    if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
      showToast('Cache file must contain a JSON object (domain → group mappings)', 'error');
      return;
    }
    // T10.15: Accept both old format (string values) and new format (object with group/timestamp)
    for (const [key, value] of Object.entries(imported)) {
      if (typeof key !== 'string') {
        showToast('Invalid cache entry — each key must be a string', 'error');
        return;
      }
      if (typeof value === 'string') {
        // Old format: convert to new format on import
        imported[key] = { group: value, timestamp: Date.now() };
      } else if (typeof value === 'object' && value !== null && typeof value.group === 'string') {
        // New format: ensure timestamp exists
        if (!value.timestamp) {
          imported[key].timestamp = Date.now();
        }
      } else {
        showToast('Invalid cache entry — each value must be a string (group name) or an object with a "group" property', 'error');
        return;
      }
    }

    const importedCount = Object.keys(imported).length;
    if (importedCount === 0) {
      showToast('Cache file is empty', 'warning');
      return;
    }

    // Prompt user: merge or overwrite?
    // First ask: merge? If yes → merge. If no → ask overwrite.
    const doMerge = await showConfirmModal(
      `Import ${importedCount} cache entr${importedCount === 1 ? 'y' : 'ies'}?\n\n` +
      `Click OK to merge (add new entries, keep existing).\n` +
      `Click Cancel to overwrite (replace all existing entries).`
    );

    if (doMerge) {
      // Merge: add new, keep existing
      const result = await browser.storage.local.get(CACHE_KEY);
      const existing = result[CACHE_KEY] || {};
      let added = 0;
      let skipped = 0;
      for (const [domain, entry] of Object.entries(imported)) {
        if (existing[domain] === undefined) {
          existing[domain] = entry;
          added++;
        } else {
          skipped++;
        }
      }
      await browser.storage.local.set({ [CACHE_KEY]: existing });
      showToast(`Imported: ${added} added, ${skipped} skipped (already existed)`, 'success', TOAST_IMPORT_MS);
    } else {
      // Overwrite — ask for confirmation
      const confirmOverwrite = await showConfirmModal(
        `Replace the entire cache with ${importedCount} imported entr${importedCount === 1 ? 'y' : 'ies'}?\n` +
        `This will delete all existing entries.`
      );
      if (!confirmOverwrite) {
        showToast('Import cancelled', 'warning');
        return;
      }
      await browser.storage.local.set({ [CACHE_KEY]: imported });
      showToast(`Cache overwritten with ${importedCount} entr${importedCount === 1 ? 'y' : 'ies'}`, 'success', TOAST_IMPORT_MS);
    }

    loadCacheStats();
    loadCacheDashboard();
  } catch (err) {
    console.error('TabTamer: failed to import cache', err);
    showToast('Failed to import cache', 'error');
  } finally {
    setButtonLoading(importCacheBtn, false);
    // Reset file input so the same file can be re-imported
    event.target.value = '';
  }
}

// ─── Clear cache ──────────────────────────────────────────────────────────────

async function clearCache() {
  // T3.10: Read cache to show count in confirmation dialog
  let entryCount = 0;
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    entryCount = Object.keys(cache).length;
  } catch (err) {
    console.error('TabTamer: failed to read cache count', err);
  }

  const message = `Clear all ${entryCount} cached domain mapping${entryCount !== 1 ? 's' : ''}? This will cause LLM API calls for every domain on next visit.`;
  const confirmed = await showConfirmModal(message);
  if (!confirmed) {
    return;
  }

  setButtonLoading(clearCacheBtn, true, 'Clearing…');
  try {
    await browser.storage.local.set({ [CACHE_KEY]: {} });
    showToast('Domain cache cleared');
    loadCacheStats();
    loadCacheDashboard();
  } catch (err) {
    console.error('TabTamer: failed to clear cache', err);
    showToast('Failed to clear cache', 'error');
  } finally {
    setButtonLoading(clearCacheBtn, false);
  }
}

// ─── Cost tracking ───────────────────────────────────────────────────────────

async function loadCosts() {
  try {
    const result = await browser.storage.local.get(COSTS_KEY);
    const costs = result[COSTS_KEY] || { calls: 0, estimatedTokens: 0, liveTokens: 0 };
    costCalls.textContent = costs.calls;
    costTokens.textContent = costs.estimatedTokens;
    costLiveTokens.textContent = costs.liveTokens || 0;
  } catch (err) {
    console.error('TabTamer: failed to load costs', err);
    showToast('Failed to load cost data', 'error');
  }
}

async function resetCosts() {
  setButtonLoading(resetCostsBtn, true, 'Resetting…');
  try {
    await browser.storage.local.set({ [COSTS_KEY]: { calls: 0, estimatedTokens: 0, liveTokens: 0 } });
    costCalls.textContent = '0';
    costTokens.textContent = '0';
    costLiveTokens.textContent = '0';
    showToast('Costs reset');
  } catch (err) {
    console.error('TabTamer: failed to reset costs', err);
    showToast('Failed to reset costs', 'error');
  } finally {
    setButtonLoading(resetCostsBtn, false);
  }
}

// ─── Test API Key ────────────────────────────────────────────────────────────
// T4.4: Send a minimal request to verify the API key works

async function testApiKey() {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showToast('Enter an API key first', 'error');
    return;
  }

  if (!/^sk-/.test(apiKey)) {
    showToast('API key should start with sk-', 'error');
    return;
  }

  // Build settings object from current form values
  const settings = {
    providerPreset: providerPresetSelect.value,
    customEndpoint: customEndpointInput.value.trim(),
    model: modelInput.value.trim(),
  };
  const endpoint = resolveEndpoint(settings);
  const model = resolveModel(settings);

  if (!endpoint) {
    showToast('No API endpoint configured', 'error');
    setButtonLoading(testApiKeyBtn, false);
    return;
  }

  if (!model) {
    showToast('No model configured', 'error');
    setButtonLoading(testApiKeyBtn, false);
    return;
  }

  setButtonLoading(testApiKeyBtn, true, 'Testing…');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 5,
        temperature: 0
      })
    });

    if (response.ok) {
      showToast('API key is valid', 'success');
    } else if (response.status === 401 || response.status === 403) {
      showToast('API key is invalid (unauthorized)', 'error');
    } else {
      showToast(`Unexpected response: ${response.status}`, 'error');
    }
  } catch (err) {
    console.error('TabTamer: API key test failed', err);
    showToast('Network error — could not reach API', 'error');
  } finally {
    setButtonLoading(testApiKeyBtn, false);
  }
}

// T10.5: Handle provider preset change
function handleProviderPresetChange() {
  onProviderPresetChange();
}

// T10.5: Fetch pricing for selected provider
async function handleFetchPricing() {
  const preset = providerPresetSelect.value;
  const presetData = PROVIDER_PRESETS[preset];
  
  if (!presetData || preset === 'custom') {
    showToast('Pricing info not available for this provider', 'warning');
    return;
  }

  costPerMillionInput.value = String(presetData.costPerMillion);
  showToast(`Updated pricing: ~$${presetData.costPerMillion}/M tokens`, 'success');
}

// ─── Keyboard Shortcuts Display ────────────────────────────────────────────
// T4.5: Show available keyboard shortcuts so users can discover them

async function loadShortcuts() {
  try {
    const commands = await browser.commands.getAll();
    const listEl = document.getElementById('shortcuts-list');
    if (!listEl) return;

    if (commands.length === 0) {
      listEl.innerHTML = '<p style="color: var(--text-muted);">No shortcuts registered</p>';
      return;
    }

    const items = commands.map(cmd => {
      const shortcut = cmd.shortcut || '<em style="color: var(--text-muted);">not set</em>';
      const desc = cmd.description || cmd.name;
      return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border);">
        <span>${desc}</span>
        <kbd style="background: var(--bg); padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; border: 1px solid var(--border);">${shortcut}</kbd>
      </div>`;
    }).join('');

    listEl.innerHTML = items;
  } catch (err) {
    console.error('TabTamer: failed to load shortcuts', err);
    const listEl = document.getElementById('shortcuts-list');
    if (listEl) {
      listEl.innerHTML = '<p style="color: var(--text-muted);">Could not load shortcuts</p>';
    }
  }
}

// ─── Excluded Domains (T6.9) ───────────────────────────────────────────────

async function loadExcludedDomains() {
  try {
    const result = await browser.storage.local.get(EXCLUDED_DOMAINS_KEY);
    const excluded = result[EXCLUDED_DOMAINS_KEY] || [];
    excludedDomainsInput.value = excluded.join('\n');
    // T7.15: Show excluded domain count as a badge on the section header
    const badge = document.getElementById('excluded-count-badge');
    if (badge) {
      badge.textContent = excluded.length;
      badge.style.display = excluded.length > 0 ? 'inline' : 'none';
    }
  } catch (err) {
    console.error('TabTamer: failed to load excluded domains', err);
    showToast('Failed to load excluded domains', 'error');
  }
}

async function saveExcludedDomains() {
  setButtonLoading(saveExcludedDomainsBtn, true, 'Saving…');

  // Split by newlines, trim whitespace, filter out empty lines
  const lines = excludedDomainsInput.value.split('\n').map(l => l.trim()).filter(Boolean);

  // Basic validation: no empty strings, no IP addresses (optional, just a sanity check)
  const valid = lines.filter(d => {
    if (!d) return false;
    // Must not contain spaces
    if (d.includes(' ')) return false;
    return true;
  });

  if (valid.length !== lines.length) {
    showToast('Invalid domain format — domains must not contain spaces', 'error');
    setButtonLoading(saveExcludedDomainsBtn, false);
    return;
  }

  try {
    await browser.storage.local.set({ [EXCLUDED_DOMAINS_KEY]: valid });
    _markClean();
    showToast(`Excluded domains saved (${valid.length} entr${valid.length === 1 ? 'y' : 'ies'})`, 'success');
    // T7.15: Update badge after save
    const badge = document.getElementById('excluded-count-badge');
    if (badge) {
      badge.textContent = valid.length;
      badge.style.display = valid.length > 0 ? 'inline' : 'none';
    }
  } catch (err) {
    console.error('TabTamer: failed to save excluded domains', err);
    showToast('Failed to save excluded domains', 'error');
  } finally {
    setButtonLoading(saveExcludedDomainsBtn, false);
  }
}

// ─── Custom Group Rules (T7.9) ───────────────────────────────────────────────

const rulePatternInput = document.getElementById('rule-pattern-input');
const ruleGroupInput = document.getElementById('rule-group-input');
const addRuleBtn = document.getElementById('add-rule-btn');
const rulesTable = document.getElementById('rules-table');
const rulesTableBody = document.getElementById('rules-table-body');
const rulesEmptyMessage = document.getElementById('rules-empty-message');
const rulesValidationError = document.getElementById('rules-validation-error');
const exportRulesBtn = document.getElementById('export-rules-btn');
const importRulesBtn = document.getElementById('import-rules-btn');
const rulesFileInput = document.getElementById('rules-file-input');

function showRulesValidationError(message) {
  rulesValidationError.textContent = message;
  rulesValidationError.style.display = 'block';
}

function hideRulesValidationError() {
  rulesValidationError.style.display = 'none';
}

async function loadRulesTable() {
  try {
    const rules = await TabTamerRules.loadRules();
    const hitCounts = await TabTamerRules.getHitCounts();

    const bulkActions = document.getElementById('rules-bulk-actions');

    if (rules.length === 0) {
      rulesTable.style.display = 'none';
      rulesEmptyMessage.style.display = 'block';
      rulesTableBody.innerHTML = '';
      if (bulkActions) bulkActions.style.display = 'none';
      return;
    }

    rulesTable.style.display = 'table';
    rulesEmptyMessage.style.display = 'none';
    if (bulkActions) bulkActions.style.display = 'flex';

    const rows = rules.map((rule, index) => {
      const escapedPattern = (rule.pattern || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escapedGroup = (rule.groupName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const checkedAttr = rule.enabled !== false ? 'checked' : '';
      const key = rule.pattern + '|' + rule.groupName;
      const hitCount = hitCounts[key] || 0;
      return `<tr data-index="${index}">
        <td style="padding: 6px 8px; text-align: center; vertical-align: middle;">
          <input type="checkbox" class="rule-select" data-index="${index}" style="accent-color: var(--primary); cursor: pointer;">
        </td>
        <td style="padding: 6px 8px; word-break: break-all; vertical-align: middle;"><code style="background: var(--bg); padding: 1px 4px; border-radius: 3px; font-size: 12px;">${escapedPattern}</code></td>
        <td style="padding: 6px 8px; vertical-align: middle;">${escapedGroup}</td>
        <td style="padding: 6px 8px; text-align: center; vertical-align: middle;">
          <input type="checkbox" class="rule-toggle" ${checkedAttr} style="accent-color: var(--primary); cursor: pointer;">
        </td>
        <td style="padding: 6px 8px; text-align: center; vertical-align: middle; font-size: 12px; color: var(--text-muted);">${hitCount}</td>
        <td style="padding: 6px 8px; text-align: right; white-space: nowrap; vertical-align: middle;">
          <button class="btn-cache-action btn-rule-move-up" ${index === 0 ? 'disabled style="opacity:0.3"' : ''} title="Move up">▲</button>
          <button class="btn-cache-action btn-rule-move-down" ${index === rules.length - 1 ? 'disabled style="opacity:0.3"' : ''} title="Move down">▼</button>
          <button class="btn-cache-action btn-cache-delete btn-rule-delete" title="Delete rule">✕</button>
        </td>
      </tr>`;
    }).join('');

    rulesTableBody.innerHTML = rows;
  } catch (err) {
    console.error('TabTamer: failed to load rules table', err);
    rulesTable.style.display = 'none';
    rulesEmptyMessage.textContent = 'Could not load rules';
    rulesEmptyMessage.style.display = 'block';
  }
}

async function handleAddRule() {
  const pattern = rulePatternInput.value.trim();
  const groupName = ruleGroupInput.value.trim();

  hideRulesValidationError();

  if (!pattern) {
    showRulesValidationError('Please enter a domain pattern.');
    rulePatternInput.focus();
    return;
  }

  if (!groupName) {
    showRulesValidationError('Please enter a group name.');
    ruleGroupInput.focus();
    return;
  }

  if (!TabTamerRules.isValidPattern(pattern)) {
    showRulesValidationError('Invalid domain pattern. Use bare domains only (no scheme, path, or port). E.g., "github.com" or "*.internal.corp".');
    rulePatternInput.focus();
    return;
  }

  try {
    await TabTamerRules.addRule(pattern, groupName, true);
    rulePatternInput.value = '';
    ruleGroupInput.value = '';
    rulePatternInput.focus();
    await loadRulesTable();
    _markClean();
    showToast(`Rule added: "${pattern}" → "${groupName}"`, 'success');
  } catch (err) {
    console.error('TabTamer: failed to add rule', err);
    showToast('Failed to add rule', 'error');
  }
}

async function handleDeleteRule(index) {
  try {
    await TabTamerRules.removeRule(index);
    await loadRulesTable();
    _markClean();
    showToast('Rule deleted', 'success');
  } catch (err) {
    console.error('TabTamer: failed to delete rule', err);
    showToast('Failed to delete rule', 'error');
  }
}

async function handleToggleRule(index, enabled) {
  try {
    await TabTamerRules.updateRule(index, { enabled });
    // Refresh table to update toggle state (though it's already visually toggled)
    await loadRulesTable();
    _markClean();
  } catch (err) {
    console.error('TabTamer: failed to toggle rule', err);
    showToast('Failed to update rule', 'error');
    // Revert the toggle by reloading
    await loadRulesTable();
  }
}

async function handleMoveRule(fromIndex, direction) {
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  try {
    await TabTamerRules.reorderRules(fromIndex, toIndex);
    await loadRulesTable();
    _markClean();
  } catch (err) {
    console.error('TabTamer: failed to reorder rule', err);
    showToast('Failed to reorder rule', 'error');
  }
}

function setupRulesTableEvents() {
  rulesTableBody.addEventListener('click', async (event) => {
    const row = event.target.closest('tr');
    if (!row) return;

    const index = parseInt(row.dataset.index, 10);

    // Delete button
    if (event.target.classList.contains('btn-rule-delete')) {
      handleDeleteRule(index);
      return;
    }

    // Move up button
    if (event.target.classList.contains('btn-rule-move-up')) {
      handleMoveRule(index, 'up');
      return;
    }

    // Move down button
    if (event.target.classList.contains('btn-rule-move-down')) {
      handleMoveRule(index, 'down');
      return;
    }
  });

  // Toggle checkboxes (delegated change event)
  rulesTableBody.addEventListener('change', async (event) => {
    if (event.target.classList.contains('rule-toggle')) {
      const row = event.target.closest('tr');
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      const enabled = event.target.checked;
      await handleToggleRule(index, enabled);
    }
  });

  // T10.18: Select All / Deselect All
  const selectAllCheckbox = document.getElementById('rules-select-all');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      const checked = selectAllCheckbox.checked;
      document.querySelectorAll('.rule-select').forEach(cb => {
        cb.checked = checked;
      });
    });
  }

  // T10.18: Bulk action handlers
  const bulkDelete = document.getElementById('rules-bulk-delete');
  const bulkDisable = document.getElementById('rules-bulk-disable');
  const bulkEnable = document.getElementById('rules-bulk-enable');

  async function getSelectedIndices() {
    const checkboxes = document.querySelectorAll('.rule-select:checked');
    return Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10)).filter(i => !isNaN(i));
  }

  if (bulkDelete) {
    bulkDelete.addEventListener('click', async () => {
      const indices = await getSelectedIndices();
      if (indices.length === 0) {
        showToast('No rules selected', 'warning');
        return;
      }
      const confirmed = await showConfirmModal(`Delete ${indices.length} selected rule${indices.length !== 1 ? 's' : ''}?`);
      if (!confirmed) return;
      // Delete in reverse order to preserve index stability
      indices.sort((a, b) => b - a);
      for (const idx of indices) {
        try {
          await TabTamerRules.removeRule(idx);
        } catch (err) {
          console.error('TabTamer: bulk delete failed for rule', idx, err);
        }
      }
      await loadRulesTable();
      _markClean();
      showToast(`Deleted ${indices.length} rule${indices.length !== 1 ? 's' : ''}`, 'success');
    });
  }

  if (bulkDisable) {
    bulkDisable.addEventListener('click', async () => {
      const indices = await getSelectedIndices();
      if (indices.length === 0) {
        showToast('No rules selected', 'warning');
        return;
      }
      for (const idx of indices) {
        try {
          await TabTamerRules.updateRule(idx, { enabled: false });
        } catch (err) {
          console.error('TabTamer: bulk disable failed for rule', idx, err);
        }
      }
      await loadRulesTable();
      _markClean();
      showToast(`Disabled ${indices.length} rule${indices.length !== 1 ? 's' : ''}`, 'success');
    });
  }

  if (bulkEnable) {
    bulkEnable.addEventListener('click', async () => {
      const indices = await getSelectedIndices();
      if (indices.length === 0) {
        showToast('No rules selected', 'warning');
        return;
      }
      for (const idx of indices) {
        try {
          await TabTamerRules.updateRule(idx, { enabled: true });
        } catch (err) {
          console.error('TabTamer: bulk enable failed for rule', idx, err);
        }
      }
      await loadRulesTable();
      _markClean();
      showToast(`Enabled ${indices.length} rule${indices.length !== 1 ? 's' : ''}`, 'success');
    });
  }
}

// ─── Rules Export / Import ─────────────────────────────────────────────────

async function exportRules() {
  setButtonLoading(exportRulesBtn, true, 'Exporting…');
  try {
    const rules = await TabTamerRules.exportRules();
    const json = JSON.stringify(rules, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `tabtamer-rules-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${rules.length} rule${rules.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) {
    console.error('TabTamer: failed to export rules', err);
    showToast('Failed to export rules', 'error');
  } finally {
    setButtonLoading(exportRulesBtn, false);
  }
}

async function handleRulesFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  setButtonLoading(importRulesBtn, true, 'Importing…');

  try {
    const text = await file.text();
    let imported;
    try {
      imported = JSON.parse(text);
    } catch {
      showToast('Invalid JSON file', 'error');
      return;
    }

    if (!Array.isArray(imported)) {
      showToast('Rules file must contain a JSON array of rule objects', 'error');
      return;
    }

    // Validate structure
    for (const [i, rule] of imported.entries()) {
      if (!rule.pattern || typeof rule.pattern !== 'string') {
        showToast(`Rule ${i + 1}: missing or invalid "pattern"`, 'error');
        return;
      }
      if (!rule.groupName || typeof rule.groupName !== 'string') {
        showToast(`Rule ${i + 1}: missing or invalid "groupName"`, 'error');
        return;
      }
    }

    // Prompt: merge or overwrite?
    const doMerge = await showConfirmModal(
      `Import ${imported.length} rule${imported.length !== 1 ? 's' : ''}?\n\n` +
      `Click OK to merge (add new rules at the end).\n` +
      `Click Cancel to overwrite (replace all existing rules).`
    );

    if (doMerge) {
      // Merge: load existing rules, append new ones
      const existing = await TabTamerRules.loadRules();
      const merged = [...existing, ...imported];
      await TabTamerRules.saveRules(merged);
      _markClean();
      showToast(`Imported: ${imported.length} rule${imported.length !== 1 ? 's' : ''} merged`, 'success', TOAST_IMPORT_MS);
    } else {
      // Overwrite
      const confirmOverwrite = await showConfirmModal(
        `Replace all existing rules with ${imported.length} imported rule${imported.length !== 1 ? 's' : ''}?`
      );
      if (!confirmOverwrite) {
        showToast('Import cancelled', 'warning');
        return;
      }
      await TabTamerRules.saveRules(imported);
      _markClean();
      showToast(`Rules overwritten with ${imported.length} rule${imported.length !== 1 ? 's' : ''}`, 'success', TOAST_IMPORT_MS);
    }

    await loadRulesTable();
  } catch (err) {
    console.error('TabTamer: failed to import rules', err);
    showToast('Failed to import rules', 'error');
  } finally {
    setButtonLoading(importRulesBtn, false);
    event.target.value = '';
  }
}

// ─── Tab Navigation (T7.14) ──────────────────────────────────────
// Switch between General, Rules, Cache, Privacy, and Info tabs.

function switchTab(tabName) {
  // Update tab button states
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Show selected tab content, hide others
  document.querySelectorAll('.tab-content').forEach(section => {
    const isActive = section.id === 'tab-' + tabName;
    section.classList.toggle('active', isActive);
  });

  // T10.16: Persist active tab to sessionStorage (survives F5)
  try {
    sessionStorage.setItem('tabtamerActiveTab', tabName);
  } catch (e) {
    // sessionStorage may not be available in all contexts
  }
}

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });
}

// ─── Event listeners ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadGroupColors().then(() => {
    loadCacheDashboard();
  });
  loadSettings();
  loadCosts();
  loadCacheStats();
  loadVersion();
  loadShortcuts();
  loadExcludedDomains();
  loadRulesTable();
  setupCacheDashboardEvents();
  setupRulesTableEvents();
  setupTabNavigation();

  // T10.16: Restore last active tab from sessionStorage (if any)
  try {
    const savedTab = sessionStorage.getItem('tabtamerActiveTab');
    if (savedTab && ['general', 'rules', 'cache', 'privacy', 'info'].includes(savedTab)) {
      switchTab(savedTab);
    }
  } catch (e) {
    // sessionStorage may not be available
  }
});
// ─── Version display ────────────────────────────────────────────────────────────

function loadVersion() {
  const manifest = browser.runtime.getManifest();
  document.getElementById('version-display').textContent = `v${manifest.version}`;
}

// ─── Unsaved Changes Warning: mark dirty on form field changes (T9.17) ──

[apiKeyInput, providerPresetSelect, customEndpointInput, modelInput, costPerMillionInput, themeSelect, enabledCheckbox, batchClusteringCheckbox, hibernateAfterSelect].forEach(el => {
  const eventType = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(eventType, _markDirty);
});
excludedDomainsInput.addEventListener('input', _markDirty);
rulePatternInput.addEventListener('input', _markDirty);
ruleGroupInput.addEventListener('input', _markDirty);

// ─── Unsaved Changes Warning: beforeunload handler (T9.17) ──────────

window.addEventListener('beforeunload', (event) => {
  if (_isDirty) {
    event.preventDefault();
    // Firefox requires returnValue to be set
    event.returnValue = '';
  }
});

// ─── T10.9: Suggest Rules Event Listeners ────────────────────────────────

if (suggestRulesBtn) {
  suggestRulesBtn.addEventListener('click', handleSuggestRules);
}

if (suggestSelectAll) {
  suggestSelectAll.addEventListener('change', () => {
    const checked = suggestSelectAll.checked;
    document.querySelectorAll('.suggest-checkbox').forEach(cb => {
      cb.checked = checked;
    });
  });
}

// Delegated change handler for individual checkboxes to sync select-all
if (suggestTableBody) {
  suggestTableBody.addEventListener('change', (e) => {
    if (e.target.classList.contains('suggest-checkbox')) {
      const all = document.querySelectorAll('.suggest-checkbox');
      const checked = document.querySelectorAll('.suggest-checkbox:checked');
      suggestSelectAll.checked = all.length === checked.length;
    }
  });
}

if (suggestApproveBtn) {
  suggestApproveBtn.addEventListener('click', approveSelectedSuggestions);
}

if (suggestDismissBtn) {
  suggestDismissBtn.addEventListener('click', dismissSuggestions);
}

if (suggestModal) {
  // Close modal when clicking overlay background
  suggestModal.addEventListener('click', (e) => {
    if (e.target === suggestModal) {
      dismissSuggestions();
    }
  });
}

// ─── Event Listeners ────────────────────────────────────────────────

// ─── Reset to Defaults (T11.14) ────────────────────────────────────────────

async function resetToDefaults() {
  const confirmed = await showConfirmModal(
    'Reset all settings to their default values?\n\n' +
    'This will restore factory defaults for all settings, costs, excluded domains, ' +
    'rules, cache, and group colors. This action cannot be undone.'
  );
  if (!confirmed) return;

  setButtonLoading(resetDefaultsBtn, true, 'Resetting…');

  try {
    // Reset settings to defaults
    await browser.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULTS } });

    // Reset costs to zero
    await browser.storage.local.set({ [COSTS_KEY]: { calls: 0, estimatedTokens: 0, liveTokens: 0 } });

    // Reset excluded domains to empty
    await browser.storage.local.set({ [EXCLUDED_DOMAINS_KEY]: [] });

    // Reset group colors to empty
    await browser.storage.local.set({ [GROUP_COLORS_KEY]: {} });

    // Clear recent classifications
    await browser.storage.local.set({ [RECENT_CLASSIFICATIONS_KEY]: [] });

    // Reset local state
    _groupColors = {};
    _markClean();

    // Reload all form sections
    await loadSettings();
    await loadCosts();
    await loadExcludedDomains();
    await loadRulesTable();
    await loadCacheDashboard();
    await loadCacheStats();

    showToast('All settings reset to defaults', 'success');
  } catch (err) {
    console.error('TabTamer: failed to reset settings', err);
    showToast('Failed to reset settings', 'error');
  } finally {
    setButtonLoading(resetDefaultsBtn, false);
  }
}

resetDefaultsBtn.addEventListener('click', resetToDefaults);

form.addEventListener('submit', saveSettings);
themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
clearCacheBtn.addEventListener('click', clearCache);
exportCacheBtn.addEventListener('click', exportCache);
importCacheBtn.addEventListener('click', () => cacheFileInput.click());
cacheFileInput.addEventListener('change', handleCacheFileSelected);
resetCostsBtn.addEventListener('click', resetCosts);
testApiKeyBtn.addEventListener('click', testApiKey);
saveExcludedDomainsBtn.addEventListener('click', saveExcludedDomains);

// T10.5: Multi-provider event listeners
providerPresetSelect.addEventListener('change', handleProviderPresetChange);
if (fetchPricingBtn) {
  fetchPricingBtn.addEventListener('click', handleFetchPricing);
}

// ─── Rules event listeners (T7.9) ────────────────────────────────────────────

addRuleBtn.addEventListener('click', handleAddRule);
rulePatternInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRule(); } });
ruleGroupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRule(); } });
exportRulesBtn.addEventListener('click', exportRules);
importRulesBtn.addEventListener('click', () => rulesFileInput.click());
rulesFileInput.addEventListener('change', handleRulesFileSelected);

// T11.15: Reset hit counts button
const resetHitCountsBtn = document.getElementById('reset-hit-counts-btn');
if (resetHitCountsBtn) {
  resetHitCountsBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmModal('Reset all rule hit counts to zero?');
    if (!confirmed) return;
    try {
      await TabTamerRules.resetAllHitCounts();
      await loadRulesTable();
      showToast('Rule hit counts reset', 'success');
    } catch (err) {
      console.error('TabTamer: failed to reset hit counts', err);
      showToast('Failed to reset hit counts', 'error');
    }
  });
}
