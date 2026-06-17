// TabTamer — Shared Utilities
// T7.17: Extract shared utility functions from background.js to a single module,
// eliminating duplication and making them available to options.js for validation.
//
// Load this script AFTER lib/constants.js but BEFORE background.js / options.js.
// All functions are defined as globals for use across the extension.

// ═══════════════════════════════════════════════════════════════════════════════
// Known Acronyms — preserved in title-case normalization
// ═══════════════════════════════════════════════════════════════════════════════

const KNOWN_ACRONYMS = new Map([
  ['API', 'API'],
  ['URL', 'URL'],
  ['DNS', 'DNS'],
  ['SSH', 'SSH'],
  ['CPU', 'CPU'],
  ['GPU', 'GPU'],
  ['HTML', 'HTML'],
  ['CSS', 'CSS'],
  ['JS', 'JS'],
  ['JSON', 'JSON'],
  ['XML', 'XML'],
  ['YAML', 'YAML'],
  ['CSV', 'CSV'],
  ['PDF', 'PDF'],
  ['SQL', 'SQL'],
  ['HTTP', 'HTTP'],
  ['HTTPS', 'HTTPS'],
  ['SSL', 'SSL'],
  ['TLS', 'TLS'],
  ['VPN', 'VPN'],
  ['CI', 'CI'],
  ['CD', 'CD'],
  ['PR', 'PR'],
  ['AI', 'AI'],
  ['ML', 'ML'],
  ['LLM', 'LLM'],
  ['UI', 'UI'],
  ['UX', 'UX'],
  ['CLI', 'CLI'],
  ['SDK', 'SDK'],
  ['IDE', 'IDE'],
  ['AWS', 'AWS'],
  ['GCP', 'GCP'],
  ['NIXOS', 'NixOS'],
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Known CamelCase Proper Nouns — preserved as-is during normalization
// (checked before acronyms to let them pass through untouched)
// ═══════════════════════════════════════════════════════════════════════════════

const KNOWN_CAMELCASE = new Set([
  'GitHub', 'YouTube', 'GitLab', 'Reddit', 'LinkedIn',
  'eBay', 'Upwork', 'WhatsApp', 'PayPal', 'TikTok',
  'WordPress', 'Medium', 'Substack', 'UberEats', 'DoorDash',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// sleep — Promise-based delay
// ═══════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// extractDomain — Extract hostname from URL, skip non-http(s) or malformed URLs
// ═══════════════════════════════════════════════════════════════════════════════

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname;
    }
    return null; // non-http(s) protocol → skip
  } catch {
    return null; // malformed URL → skip
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// normalizeGroupName — Trim and Title Case group names to prevent near-duplicate
// groups. Preserves known acronyms (e.g., "API", "CLI") in canonical uppercase.
// T7.17: Case-insensitive acronym matching — "api" → "API", "url" → "URL"
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeGroupName(name) {
  return name
    .trim()
    .split(/\s+/)
    .map(word => {
      // Preserve known camelCase proper nouns (checked before acronyms)
      if (KNOWN_CAMELCASE.has(word)) {
        return word;
      }
      const upper = word.toUpperCase();
      // T7.17: Removed /[A-Z]/ check — match acronyms case-insensitively
      if (KNOWN_ACRONYMS.has(upper)) {
        return KNOWN_ACRONYMS.get(upper);
      }
      // Standard title-case
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cache Helpers — T10.15: Handle both old string format and new object format
// ═══════════════════════════════════════════════════════════════════════════════

function _getCacheGroupName(entry) {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : (entry.group || null);
}

function _getCacheTimestamp(entry) {
  if (!entry || typeof entry === 'string') return null;
  return entry.timestamp || null;
}
