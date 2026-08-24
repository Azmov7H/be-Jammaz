// T-PERF-05: user input must never reach $regex unescaped — a raw `(` or
// `.*.*.*` from the UI would either throw or trigger catastrophic scans.
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Escape all regex metacharacters so input matches literally.
 * @param {string} input
 * @returns {string}
 */
export function escapeRegExp(input) {
    return String(input ?? '').replace(ESCAPE_RE, '\\$&');
}

/**
 * Case-insensitive literal substring matcher for Mongo $regex fields.
 * @param {string} input
 */
export function literalContains(input) {
    return { $regex: escapeRegExp(input), $options: 'i' };
}
