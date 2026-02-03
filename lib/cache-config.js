/**
 * Centralized Cache Configuration
 * Defines staleTime and cacheTime for React Query hooks
 */

export const CACHE_CONFIG = {
    // Static/Metadata (rarely changes)
    METADATA: {
        staleTime: 5 * 60 * 1000,    // 5 minutes
        cacheTime: 10 * 60 * 1000,   // 10 minutes
    },

    // Products (moderate frequency changes)
    PRODUCTS: {
        staleTime: 60 * 1000,        // 1 minute
        cacheTime: 5 * 60 * 1000,    // 5 minutes
    },

    // Financial data (needs to be fresh)
    INVOICES: {
        staleTime: 0,                // Always refetch
        cacheTime: 2 * 60 * 1000,    // 2 minutes in cache
    },

    CUSTOMERS: {
        staleTime: 0,                // Always refetch
        cacheTime: 2 * 60 * 1000,    // 2 minutes
    },

    SUPPLIERS: {
        staleTime: 30 * 1000,        // 30 seconds
        cacheTime: 5 * 60 * 1000,    // 5 minutes
    },

    PURCHASE_ORDERS: {
        staleTime: 30 * 1000,        // 30 seconds
        cacheTime: 5 * 60 * 1000,    // 5 minutes
    },

    // Real-time data
    NOTIFICATIONS: {
        staleTime: 0,                // Always refetch
        cacheTime: 60 * 1000,        // 1 minute
        refetchInterval: 60000,      // Poll every minute
    },

    // Dashboard/Analytics
    DASHBOARD: {
        staleTime: 30 * 1000,        // 30 seconds
        cacheTime: 2 * 60 * 1000,    // 2 minutes
    },

    REPORTS: {
        staleTime: 2 * 60 * 1000,    // 2 minutes
        cacheTime: 10 * 60 * 1000,   // 10 minutes
    },

    // Stock movements (moderate frequency)
    STOCK: {
        staleTime: 60 * 1000,        // 1 minute
        cacheTime: 5 * 60 * 1000,    // 5 minutes
    },
};


