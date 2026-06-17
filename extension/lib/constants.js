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
