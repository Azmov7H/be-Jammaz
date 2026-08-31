/**
 * DOC-SHARED-001 — Centralized branding accessor.
 *
 * Every document (invoice / receipt / statement / report) renders with the
 * same branded header. This helper returns the canonical BrandingData shape
 * derived from the InvoiceSettings singleton. It is the SINGLE source of
 * truth for document branding — no document should read InvoiceSettings
 * directly.
 *
 * Performance: branded data is cached in-process for 60s (T-PERF-02).
 * Settings are effectively read-only outside of /api/settings, so the cache
 * stays fresh enough for the user. The cache is invalidated on a best-effort
 * basis when the settings are updated (the writer in routes/settingsRoutes
 * calls `invalidateBrandingCache()` if it exists).
 */

import InvoiceSettings from '../models/InvoiceSettings.js';
import { createTTLCache } from './ttlCache.js';

const BRANDING_TTL_MS = 60 * 1000; // 60s
const brandingCache = createTTLCache(BRANDING_TTL_MS);

const DEFAULTS = {
    companyName: 'شركتكم',
    companyLogo: '',
    showLogo: true,
    showQRCode: true,
    primaryColor: '#1B3C73',
    headerBgColor: '#1B3C73',
    address: '',
    phone: '',
    additionalPhones: [],
    email: '',
    website: '',
    footerText: 'شكراً لتعاملكم مع شركة الجماز',
};

/**
 * @returns {Promise<BrandingData>}
 */
export async function getBranding() {
    const cached = brandingCache.get('branding');
    if (cached) return cached;

    let settings;
    try {
        settings = await InvoiceSettings.getSettings();
    } catch {
        // DB unavailable or singleton missing — return defaults.
        return { ...DEFAULTS };
    }

    if (!settings) {
        // Singleton not initialized (returns null) — return defaults.
        return { ...DEFAULTS };
    }

    const branding = {
        companyName: settings.companyName || DEFAULTS.companyName,
        companyLogo: settings.companyLogo || DEFAULTS.companyLogo,
        showLogo: settings.showLogo ?? DEFAULTS.showLogo,
        showQRCode: settings.showQRCode ?? DEFAULTS.showQRCode,
        primaryColor: settings.primaryColor || DEFAULTS.primaryColor,
        headerBgColor: settings.headerBgColor || DEFAULTS.headerBgColor,
        address: settings.address || DEFAULTS.address,
        phone: settings.phone || DEFAULTS.phone,
        additionalPhones: Array.isArray(settings.additionalPhones)
            ? settings.additionalPhones
            : DEFAULTS.additionalPhones,
        email: settings.email || DEFAULTS.email,
        website: settings.website || DEFAULTS.website,
        footerText: settings.footerText || DEFAULTS.footerText,
    };

    brandingCache.set('branding', branding);
    return branding;
}

/**
 * Invalidate the in-process branding cache. Called by the settings writer
 * after a successful update so the next document render reflects the new
 * branding immediately.
 */
export function invalidateBrandingCache() {
    brandingCache.clear();
}

export const __brandingDefaults = DEFAULTS;
