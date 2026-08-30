/**
 * Logger facade (T-SEC-05). Sprint 10 adds PII redaction (SEC-PII-002):
 * `sourceNumber` is masked to its last-4 display form and `password`/tokens are
 * fully redacted before anything hits stdout — so sensitive identifiers never
 * leak into logs. Call sites must NOT use console directly (eslint no-console).
 */
import { maskSource } from './pii.js';

const SENSITIVE_TOKENS = new Set(['password', 'token', 'refreshToken', 'accessToken']);

/**
 * Deep-redact a value for logging. sourceNumber → masked; token/password → [REDACTED].
 */
function redact(value, depth = 0) {
    if (depth > 6 || value == null) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_TOKENS.has(k)) {
            out[k] = '[REDACTED]';
        } else if (k === 'sourceNumber') {
            out[k] = maskSource(v);
        } else if (typeof v === 'object') {
            out[k] = redact(v, depth + 1);
        } else {
            out[k] = v;
        }
    }
    return out;
}

function dump(args) {
    return args.map((a) => (typeof a === 'object' && a !== null ? redact(a) : a));
}

export const logger = {
    info: (...args) => console.log(...dump(args)),
    warn: (...args) => console.warn(...dump(args)),
    error: (...args) => console.error(...dump(args)),
    /** Structured security event line; PII policy: userId only, never emails. */
    security: (event, details = {}) =>
        console.log(JSON.stringify({ event, at: new Date().toISOString(), ...redact(details) })),
};
