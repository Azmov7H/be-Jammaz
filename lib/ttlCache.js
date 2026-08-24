// T-PERF-02: tiny in-memory TTL cache (Map-backed).
// Deliberately per-process — multi-instance deployments must switch to a
// shared store; documented constraint, same as the rate limiters.
export function createTTLCache(ttlMs) {
    const store = new Map();
    return {
        get(key) {
            const entry = store.get(key);
            if (!entry) return undefined;
            if (Date.now() > entry.expiresAt) {
                store.delete(key);
                return undefined;
            }
            return entry.value;
        },
        set(key, value) {
            store.set(key, { value, expiresAt: Date.now() + ttlMs });
        },
        clear() {
            store.clear();
        },
        get size() {
            return store.size;
        }
    };
}
