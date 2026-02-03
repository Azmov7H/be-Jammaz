/**
 * Caching Constants & Tags
 * Centralized for consistent revalidation across the app
 */

export const CACHE_TAGS = {
    SETTINGS: 'settings',
    PRODUCTS: 'products',
    PRODUCT_METADATA: 'product_metadata',
    NOTIFICATIONS: 'notifications',
    CUSTOMERS: 'customers',
    INVOICES: 'invoices',
    TREASURY: 'treasury'
};

export const CACHE_TIMES = {
    STATIC: 3600,      // 1 hour (Settings, Metadata)
    INFREQUENT: 600,   // 10 minutes (Product list, Customer list)
    FREQUENT: 60,      // 1 minute (Dashboard counters, Notifications)
    NONE: 0            // No caching
};


