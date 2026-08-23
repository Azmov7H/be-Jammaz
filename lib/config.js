/**
 * Environment-driven runtime configuration (Sprint 04+).
 */
export const LOG_TTL_DAYS = parseInt(process.env.LOG_TTL_DAYS || '90', 10);
export const ALLOW_NON_ATOMIC_DEV = process.env.ALLOW_NON_ATOMIC_DEV === 'true';
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
