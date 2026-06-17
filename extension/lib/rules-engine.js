// TabTamer — Custom Group Rules Engine
// T7.9: Domain→group rules with glob patterns, priority ordering
// Rules bypass the LLM entirely for known sites, saving costs and latency.
//
// Rules stored as an ordered array:
//   [{ pattern, groupName, enabled }]
//
// Matching: glob → regex conversion. Always anchored (full domain match).
// Priority: first matching enabled rule wins.

// ─── Constants are defined in lib/constants.js (loaded first via manifest / <script>) ────

// ─── Glob to Regex ────────────────────────────────────────────────────────────
// Convert a glob pattern to a RegExp for domain matching.
// Supports * (wildcard) and ? (single char). Always anchored as full domain match.

function globToRegex(pattern) {
  // Escape regex-special characters except * and ?
  let escaped = '';
  for (const ch of pattern) {
    if (ch === '*') {
      escaped += '.*';
    } else if (ch === '?') {
      escaped += '.';
    } else if (ch === '.' || ch === '+' || ch === '^' || ch === '$' ||
               ch === '{' || ch === '}' || ch === '(' || ch === ')' ||
               ch === '|' || ch === '[' || ch === ']' || ch === '\\') {
      escaped += '\\' + ch;
    } else {
      escaped += ch;
    }
  }
  // Always anchored (full domain match)
  return new RegExp('^' + escaped + '$', 'i');
}

// ─── Pattern Containment Check ────────────────────────────────────────────────
// Returns true if the pattern contains glob characters (* or ?).

function isGlobPattern(pattern) {
  return pattern.includes('*') || pattern.includes('?');
}

// ─── Validation ───────────────────────────────────────────────────────────────
// Check that a rule's pattern is valid for domain matching.

function isValidPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return false;
  if (pattern.trim().length === 0) return false;
  // Must not contain scheme, path, port, or userinfo
  if (pattern.includes('://') || pattern.includes('/') || pattern.includes(':')) {
    return false;
  }
  // Domain labels: allow letters, digits, hyphens, dots, glob chars
  // Reject patterns with consecutive dots, leading/trailing dots, or leading glob
  const trimmed = pattern.trim().toLowerCase();
  if (trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    return false;
  }
  return true;
}

function isValidGroupName(name) {
  return name && typeof name === 'string' && name.trim().length > 0;
}

// ─── Load/Save Rules ──────────────────────────────────────────────────────────

async function loadRules() {
  try {
    const result = await browser.storage.local.get(RULES_KEY);
    return result[RULES_KEY] || [];
  } catch (err) {
    console.error('TabTamer: failed to load rules', err);
    return [];
  }
}

async function saveRules(rules) {
  try {
    await browser.storage.local.set({ [RULES_KEY]: rules });
  } catch (err) {
    console.error('TabTamer: failed to save rules', err);
    throw err;
  }
}

// ─── CRUD Operations ──────────────────────────────────────────────────────────

async function addRule(pattern, groupName, enabled = true) {
  const rules = await loadRules();
  rules.push({ pattern: pattern.trim(), groupName: groupName.trim(), enabled });
  await saveRules(rules);
  return rules;
}

async function removeRule(index) {
  const rules = await loadRules();
  if (index >= 0 && index < rules.length) {
    rules.splice(index, 1);
    await saveRules(rules);
  }
  return rules;
}

async function updateRule(index, updates) {
  const rules = await loadRules();
  if (index >= 0 && index < rules.length) {
    rules[index] = { ...rules[index], ...updates };
    await saveRules(rules);
  }
  return rules;
}

async function reorderRules(fromIndex, toIndex) {
  const rules = await loadRules();
  if (fromIndex < 0 || fromIndex >= rules.length) return rules;
  if (toIndex < 0 || toIndex >= rules.length) return rules;
  const [moved] = rules.splice(fromIndex, 1);
  rules.splice(toIndex, 0, moved);
  await saveRules(rules);
  return rules;
}

// ─── Matching ─────────────────────────────────────────────────────────────────
// Match a domain against all enabled rules. Returns the first matching group name
// or null if no rule matches. Also tracks hit counts per rule.

async function _loadHitCounts() {
  try {
    const result = await browser.storage.local.get(RULE_HIT_COUNTS_KEY);
    return result[RULE_HIT_COUNTS_KEY] || {};
  } catch (err) {
    return {};
  }
}

async function _saveHitCounts(hitCounts) {
  try {
    await browser.storage.local.set({ [RULE_HIT_COUNTS_KEY]: hitCounts });
  } catch (err) {
    console.error('TabTamer: failed to save rule hit counts', err);
  }
}

async function matchRules(domain) {
  try {
    const rules = await loadRules();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      try {
        const regex = globToRegex(rule.pattern);
        if (regex.test(domain)) {
          // T11.15: Track hit count for this rule (keyed by pattern|groupName)
          const hitCounts = await _loadHitCounts();
          const key = rule.pattern + '|' + rule.groupName;
          hitCounts[key] = (hitCounts[key] || 0) + 1;
          await _saveHitCounts(hitCounts);
          return rule.groupName;
        }
      } catch (regexErr) {
        console.warn(`TabTamer: invalid rule pattern "${rule.pattern}" — skipping`, regexErr.message);
      }
    }
    return null;
  } catch (err) {
    console.error('TabTamer: matchRules error', err);
    return null;
  }
}

// ─── Batch Operations ─────────────────────────────────────────────────────────

async function exportRules() {
  return await loadRules();
}

async function importRules(rules) {
  if (!Array.isArray(rules)) {
    throw new Error('Rules must be an array');
  }
  for (const rule of rules) {
    if (!rule.pattern || !rule.groupName) {
      throw new Error('Each rule must have a "pattern" and "groupName" property');
    }
  }
  await saveRules(rules);
  return rules;
}

// ─── Hit Counts ────────────────────────────────────────────────────────────────
// T11.15: Track hit counts per rule to help users identify which rules are most active.

async function getHitCounts() {
  return await _loadHitCounts();
}

async function resetAllHitCounts() {
  await _saveHitCounts({});
}

// ─── Module Exports ───────────────────────────────────────────────────────────
// In Firefox extensions, we share code via importScripts or direct inclusion.
// This module provides a global object for use in background.js and options.js.

const TabTamerRules = {
  RULES_KEY,
  globToRegex,
  isGlobPattern,
  isValidPattern,
  isValidGroupName,
  loadRules,
  saveRules,
  addRule,
  removeRule,
  updateRule,
  reorderRules,
  matchRules,
  getHitCounts,
  resetAllHitCounts,
  exportRules,
  importRules
};
