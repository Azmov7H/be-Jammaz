/**
 * Minimal logger facade (T-SEC-05). Sprint 10 replaces the internals with a
 * structured/pino-style implementation — call sites must NOT use console
 * directly (eslint no-console enforces this).
 */
export const logger = {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    /** Structured security event line; PII policy: userId only, never emails. */
    security: (event, details = {}) =>
        console.log(JSON.stringify({ event, at: new Date().toISOString(), ...details })),
};
