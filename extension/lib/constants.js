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
const GROUP_COLORS_KEY = 'tabtamerGroupColors';

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

const TOKENS_CLASSIFY = 150;
const TOKENS_MERGE = 500;

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
// API
// ═══════════════════════════════════════════════════════════════════════════════

// OpenAI-compatible endpoint used for classification and merge operations
const API_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';

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

// Storage key for per-group hibernation opt-out (array of group names)
const HIBERNATE_OPT_OUT_KEY = 'tabtamerHibernateOptOut';

// Throttle interval for persisting access times to storage (ms)
const STORAGE_THROTTLE_MS = 30000;
