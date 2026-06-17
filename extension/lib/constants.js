// TabTamer — Shared Constants
// T7.16: Extract all shared storage keys, magic numbers, and configuration constants
// to a single module, eliminating duplication between background.js and options.js.
//
// Load this script BEFORE any other TabTamer scripts so all modules can access
// these globals. In the background, add "lib/constants.js" first in the manifest
// scripts array. In HTML pages, add <script src="lib/constants.js"> first.

// ═══════════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_KEY = 'domainGroupCache';
const SETTINGS_KEY = 'tabtamerSettings';
const COSTS_KEY = 'tabtamerCosts';
const MANAGED_GROUPS_KEY = 'tabtamerManagedGroups';
const EXCLUDED_DOMAINS_KEY = 'tabtamerExcludedDomains';
const RULES_KEY = 'tabtamerRules';
const RULE_HIT_COUNTS_KEY = 'ruleHitCounts';
const GROUP_COLORS_KEY = 'tabtamerGroupColors';
const NO_API_KEY_NOTIFIED_KEY = 'tabtamerNotifiedNoApiKey';

// ═══════════════════════════════════════════════════════════════════════════════
// CSP Validation (T12.1)
// ═══════════════════════════════════════════════════════════════════════════════

// Host patterns allowed for custom API endpoints in strict mode
// Used in options.js to validate custom endpoint URLs at input time
const CSP_ALLOWED_HOSTS = {
  https: 'https://*/*',
  localhost: 'http://localhost:*/*'
};

// ═══════════════════════════════════════════════════════════════════════════════
// Timing & Debounce
// ═══════════════════════════════════════════════════════════════════════════════

// Debounce interval for URL change coalescing (background.js)
const DEBOUNCE_MS = 500;

// Poll interval for concurrency limiter (background.js)
const CONCURRENCY_POLL_MS = 100;

// Debounce interval for cache dashboard search (options.js)
const SEARCH_DEBOUNCE_MS = 200;

// Default toast display time (options.js)
const TOAST_DURATION_MS = 3000;

// Longer toast duration for import results so users can read counts (options.js)
const TOAST_IMPORT_MS = 5000;

// ═══════════════════════════════════════════════════════════════════════════════
// Token & Cost Estimates
// ═══════════════════════════════════════════════════════════════════════════════
// T6.8: Classification uses a short prompt + 5-word response (~150 tokens)
// Merge uses a longer prompt with group list + JSON response (~500 tokens)

// Helper: estimate token count from text length (~4 chars per token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Periodic Task Intervals
// ═══════════════════════════════════════════════════════════════════════════════

// Interval for reclassifying ungrouped tabs
const CLEANUP_INTERVAL_MIN = 15;

// Interval for LLM-based group merging
const MERGE_INTERVAL_MIN = 60;

// Interval for logging cost summary to console
const COST_LOG_INTERVAL_MIN = 1440;

// ═══════════════════════════════════════════════════════════════════════════════
// Concurrency & Retry
// ═══════════════════════════════════════════════════════════════════════════════

// Maximum concurrent LLM classification calls
const MAX_CONCURRENT = 2;

// Maximum retry attempts for API calls
const MAX_RETRIES = 5;

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Presets — Multi-Provider Support (T10.5)
// ═══════════════════════════════════════════════════════════════════════════════

const PROVIDER_PRESETS = {
  opencode: {
    label: 'Opencode',
    endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
    defaultModel: 'deepseek-v4-flash',
    costPerMillion: 1.0
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    costPerMillion: 0.15
  },
  together: {
    label: 'Together AI',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    costPerMillion: 0.20
  },
  ollama: {
    label: 'Ollama (Local)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'llama3.2',
    costPerMillion: 0
  },
  custom: {
    label: 'Custom',
    endpoint: '',
    defaultModel: '',
    costPerMillion: 0
  }
};

// Default provider preset key
const DEFAULT_PROVIDER = 'opencode';

// ───────────────────────────────────────────────────────────────
// resolveEndpoint / resolveModel — with per-session caching
// T12.3: Cache results so repeated calls within a session skip
// redundant string resolution. Call clearEndpointCache() when
// the user saves new settings.
// ───────────────────────────────────────────────────────────────

let _cachedEndpointSettingsStr = null;
let _cachedEndpoint = null;
let _cachedModelSettingsStr = null;
let _cachedModel = null;

function _settingsStr(settings) {
  return `${settings.providerPreset}|${settings.customEndpoint}|${settings.model}`;
}

// Helper: resolve the full endpoint URL from settings
// Returns the endpoint string, or the default if settings are missing
function resolveEndpoint(settings) {
  const s = _settingsStr(settings);
  if (s === _cachedEndpointSettingsStr && _cachedEndpoint !== null) {
    return _cachedEndpoint;
  }
  const preset = settings.providerPreset || DEFAULT_PROVIDER;
  let endpoint;
  if (preset === 'custom') {
    endpoint = settings.customEndpoint || '';
  } else {
    endpoint = PROVIDER_PRESETS[preset]?.endpoint || PROVIDER_PRESETS[DEFAULT_PROVIDER].endpoint;
  }
  _cachedEndpointSettingsStr = s;
  _cachedEndpoint = endpoint;
  return endpoint;
}

// Helper: resolve the model from settings
function resolveModel(settings) {
  const s = _settingsStr(settings);
  if (s === _cachedModelSettingsStr && _cachedModel !== null) {
    return _cachedModel;
  }
  const preset = settings.providerPreset || DEFAULT_PROVIDER;
  let model;
  if (preset === 'custom') {
    model = settings.model || '';
  } else {
    model = settings.model || PROVIDER_PRESETS[preset]?.defaultModel || PROVIDER_PRESETS[DEFAULT_PROVIDER].defaultModel;
  }
  _cachedModelSettingsStr = s;
  _cachedModel = model;
  return model;
}

// Clear the per-session cache — call when the user saves new settings
function clearEndpointCache() {
  _cachedEndpointSettingsStr = null;
  _cachedEndpoint = null;
  _cachedModelSettingsStr = null;
  _cachedModel = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Classification Constants
// ═══════════════════════════════════════════════════════════════════════════════

// Maximum number of recent classifications to track for popup display
const MAX_RECENT = 5;

// Maximum tokens for LLM classification responses
const CLASSIFY_MAX_TOKENS = 30;

// Maximum number of group names to include in LLM prompts (prevents token waste)
// T9.5: Prioritize groups with the most tabs, append "...and N more" if truncated
const MAX_GROUP_NAMES_IN_PROMPT = 20;

// ═══════════════════════════════════════════════════════════════════════════════
// Tab Hibernation (T9.19)
// ═══════════════════════════════════════════════════════════════════════════════

// Storage key for tab last-access times map (tabId → timestamp)
const TABTAMER_LAST_ACCESS_KEY = 'tabtamerLastAccess';

// Alarm name for periodic hibernation check
const HIBERNATE_ALARM_NAME = 'tabtamer-hibernate';

// Interval for hibernation alarm (minutes)
const HIBERNATE_INTERVAL_MIN = 10;

// Default idle time before tabs are discarded (minutes)
const DEFAULT_HIBERNATE_MINUTES = 30;

// Cooldown period for classification failure notifications (5 minutes) — T9.16
const CLASSIFY_FAILURE_COOLDOWN_MS = 300000;

// Storage key for cache of recent classifications (T9.15 — persists across restarts)
const RECENT_CLASSIFICATIONS_KEY = 'tabtamerRecentClassifications';

// Storage key for dismissed rule suggestions (T10.8 — domain → timestamp)
const DISMISSED_RULE_SUGGESTIONS_KEY = 'tabtamerDismissedRuleSuggestions';

// Storage key for pending rule suggestions (T11.6 — persists across event page suspension)
// notificationId → { domain, groupName, expiry }
const PENDING_RULE_SUGGESTIONS_KEY = 'tabtamerPendingRuleSuggestions';

// Storage key for per-group hibernation opt-out (array of group names)
const HIBERNATE_OPT_OUT_KEY = 'tabtamerHibernateOptOut';

// Throttle interval for persisting access times to storage (ms)
const STORAGE_THROTTLE_MS = 15000;

// Duration after which a dismissed rule suggestion can be re-prompted (30 days in ms)
const RULE_SUGGESTION_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

// Max age for pruning dismissed rule suggestion entries (35 days to be generous)
const RULE_SUGGESTION_PRUNE_AGE_MS = 35 * 24 * 60 * 60 * 1000;
