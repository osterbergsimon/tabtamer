// TabTamer — Options page logic
// TAS-8: Load settings, save on submit, clear cache

const SETTINGS_KEY = 'tabtamerSettings';
const CACHE_KEY = 'domainGroupCache';
const COSTS_KEY = 'tabtamerCosts';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const form = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key');
const modelSelect = document.getElementById('model');
const themeSelect = document.getElementById('theme');
const enabledCheckbox = document.getElementById('enabled');
const saveBtn = document.getElementById('save-btn');
const testApiKeyBtn = document.getElementById('test-api-key-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const exportCacheBtn = document.getElementById('export-cache-btn');
const importCacheBtn = document.getElementById('import-cache-btn');
const cacheFileInput = document.getElementById('cache-file-input');
const cacheStats = document.getElementById('cache-stats');
const resetCostsBtn = document.getElementById('reset-costs-btn');
const costCalls = document.getElementById('cost-calls');
const costTokens = document.getElementById('cost-tokens');
const toast = document.getElementById('toast');

// ─── Cache Dashboard DOM refs ────────────────────────────────────────────────

const cacheSearch = document.getElementById('cache-search');
const cacheTable = document.getElementById('cache-table');
const cacheTableBody = document.getElementById('cache-table-body');
const cacheEmptyMessage = document.getElementById('cache-empty-message');
const dashboardCacheCount = document.getElementById('dashboard-cache-count');

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

// ─── Toast helper ─────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;
  toast.setAttribute('role', 'alert');

  // Auto-dismiss after 3 seconds
  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.setAttribute('role', 'presentation');
  }, 3000);
}

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || {};

    apiKeyInput.value = settings.apiKey || '';
    modelSelect.value = settings.model || 'deepseek-v4-flash';
    themeSelect.value = settings.theme || 'system';
    enabledCheckbox.checked = settings.enabled !== false; // default enabled
    applyTheme(themeSelect.value);
  } catch (err) {
    console.error('TabTamer: failed to load settings', err);
    showToast('Failed to load settings', 'error');
  }
}

// ─── Save settings ────────────────────────────────────────────────────────────

async function saveSettings(e) {
  e.preventDefault();

  setButtonLoading(saveBtn, true, 'Saving…');

  const apiKey = apiKeyInput.value.trim();
  const theme = themeSelect.value;
  const enabled = enabledCheckbox.checked;

  // ─── Validation ────────────────────────────────────────────────

  // If API key is provided, it must start with "sk-"
  if (apiKey && !/^sk-/.test(apiKey)) {
    setButtonLoading(saveBtn, false);
    showToast('API key should start with sk-', 'error');
    return;
  }

  // If auto-grouping is enabled but no API key is set, warn but allow save
  let showedWarning = false;
  if (enabled && !apiKey) {
    showToast('Auto-grouping requires an API key', 'warning');
    showedWarning = true;
    // Continue saving despite the warning
  }

  // ─── Save ──────────────────────────────────────────────────────

  const settings = {
    apiKey,
    model: modelSelect.value,
    theme,
    enabled,
  };

  try {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });

    // If API key is set, clear the "no API key" notification flag so the user
    // gets reminded again if they later clear the key
    if (settings.apiKey) {
      await browser.storage.local.remove('_notifiedNoApiKey');
    }

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

// ─── Cache Dashboard ─────────────────────────────────────────────────────────
// T5.9: Searchable, filterable table of cached domains and groups with edit/delete

async function loadCacheDashboard() {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] || {};
    const entries = Object.entries(cache);
    const searchTerm = cacheSearch.value.trim().toLowerCase();

    // Update entry count
    dashboardCacheCount.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

    // Filter by search term
    const filtered = searchTerm
      ? entries.filter(([domain, group]) =>
          domain.toLowerCase().includes(searchTerm) ||
          group.toLowerCase().includes(searchTerm)
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
      cacheTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">No matching entries</td></tr>`;
      return;
    }

    // Build table rows
    const rows = filtered.map(([domain, group]) => {
      const escapedDomain = domain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const escapedGroup = group.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<tr data-domain="${escapedDomain}" data-group="${escapedGroup}">
        <td style="padding: 6px 8px; word-break: break-all;" class="cache-domain-cell">${escapedDomain}</td>
        <td style="padding: 6px 8px; word-break: break-all;" class="cache-group-cell">
          <span class="cache-group-text">${escapedGroup}</span>
          <input type="text" class="cache-group-edit" value="${escapedGroup}"
                 style="display:none; width: 90%; padding: 4px 6px; font-size: 12px;
                        background: var(--bg); border: 1px solid var(--primary);
                        border-radius: 4px; color: var(--text);">
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

      try {
        const result = await browser.storage.local.get(CACHE_KEY);
        const cache = result[CACHE_KEY] || {};
        cache[domain] = newGroup;
        await browser.storage.local.set({ [CACHE_KEY]: cache });

        // Update the row data
        row.dataset.group = newGroup;
        row.querySelector('.cache-group-text').textContent = newGroup;
        showToast(`Updated "${domain}" → "${newGroup}"`, 'success');
      } catch (err) {
        console.error('TabTamer: failed to update cache entry', err);
        showToast('Failed to update cache entry', 'error');
      }

      // Exit edit mode
      exitEditMode(row, domain);
      loadCacheDashboard(); // Refresh to keep state consistent
    } else if (action === 'cancel') {
      // Exit edit mode without saving
      exitEditMode(row, domain);
    } else if (action === 'delete') {
      // Confirm and delete
      const confirmed = confirm(`Remove "${domain}" from the cache? The next visit will trigger a fresh LLM classification.`);
      if (!confirmed) return;

      try {
        const result = await browser.storage.local.get(CACHE_KEY);
        const cache = result[CACHE_KEY] || {};
        delete cache[domain];
        await browser.storage.local.set({ [CACHE_KEY]: cache });
        showToast(`Removed "${domain}" from cache`, 'success');
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

    // Validate structure: must be a plain object with string values
    if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
      showToast('Cache file must contain a JSON object (domain → group mappings)', 'error');
      return;
    }
    for (const [key, value] of Object.entries(imported)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        showToast('Invalid cache entry — each key and value must be a string', 'error');
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
    const doMerge = confirm(
      `Import ${importedCount} cache entr${importedCount === 1 ? 'y' : 'ies'}?\n\n` +
      `Click OK to **merge** (add new entries, keep existing).\n` +
      `Click Cancel to **overwrite** (replace all existing entries).`
    );

    if (doMerge) {
      // Merge: add new, keep existing
      const result = await browser.storage.local.get(CACHE_KEY);
      const existing = result[CACHE_KEY] || {};
      let added = 0;
      let skipped = 0;
      for (const [domain, group] of Object.entries(imported)) {
        if (existing[domain] === undefined) {
          existing[domain] = group;
          added++;
        } else {
          skipped++;
        }
      }
      await browser.storage.local.set({ [CACHE_KEY]: existing });
      showToast(`Imported: ${added} added, ${skipped} skipped (already existed)`, 'success');
    } else {
      // Overwrite — ask for confirmation
      const confirmOverwrite = confirm(
        `Replace the entire cache with ${importedCount} imported entr${importedCount === 1 ? 'y' : 'ies'}?\n` +
        `This will delete all ${Object.keys((await browser.storage.local.get(CACHE_KEY))[CACHE_KEY] || {}).length} existing entries.`
      );
      if (!confirmOverwrite) {
        showToast('Import cancelled', 'warning');
        return;
      }
      await browser.storage.local.set({ [CACHE_KEY]: imported });
      showToast(`Cache overwritten with ${importedCount} entr${importedCount === 1 ? 'y' : 'ies'}`, 'success');
    }

    loadCacheStats();
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
  if (!confirm(message)) {
    return;
  }

  setButtonLoading(clearCacheBtn, true, 'Clearing…');
  try {
    await browser.storage.local.set({ [CACHE_KEY]: {} });
    showToast('Domain cache cleared');
    loadCacheStats();
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
    const costs = result[COSTS_KEY] || { calls: 0, estimatedTokens: 0 };
    costCalls.textContent = costs.calls;
    costTokens.textContent = costs.estimatedTokens;
  } catch (err) {
    console.error('TabTamer: failed to load costs', err);
    showToast('Failed to load cost data', 'error');
  }
}

async function resetCosts() {
  setButtonLoading(resetCostsBtn, true, 'Resetting…');
  try {
    await browser.storage.local.set({ [COSTS_KEY]: { calls: 0, estimatedTokens: 0 } });
    costCalls.textContent = '0';
    costTokens.textContent = '0';
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

  const model = modelSelect.value;
  setButtonLoading(testApiKeyBtn, true, 'Testing…');

  try {
    const response = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
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

// ─── Event listeners ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadCosts();
  loadCacheStats();
  loadVersion();
  loadShortcuts();
  loadCacheDashboard();
  setupCacheDashboardEvents();
});
// ─── Version display ────────────────────────────────────────────────────────────

function loadVersion() {
  const manifest = browser.runtime.getManifest();
  document.getElementById('version-display').textContent = `v${manifest.version}`;
}

form.addEventListener('submit', saveSettings);
themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
clearCacheBtn.addEventListener('click', clearCache);
exportCacheBtn.addEventListener('click', exportCache);
importCacheBtn.addEventListener('click', () => cacheFileInput.click());
cacheFileInput.addEventListener('change', handleCacheFileSelected);
resetCostsBtn.addEventListener('click', resetCosts);
testApiKeyBtn.addEventListener('click', testApiKey);
