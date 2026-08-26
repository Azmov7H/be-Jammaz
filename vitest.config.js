import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.js', 'lib/*.test.js', 'services/*.test.js'],
        testTimeout: 60000,
        hookTimeout: 180000,
        // single fork so one in-memory MongoDB serves all test files
        pool: 'forks',
        maxForks: 1,
        minForks: 1,
        coverage: {
            provider: 'v8',
            include: ['services/financial/**', 'middlewares/**', 'lib/**'],
            exclude: [
                // dead code pending deletion in Sprint 09 (CLN scope)
                'lib/permissions.js',
                'lib/cache-config.js',
                // connection bootstrap / topology fallbacks — exercised
                // indirectly by every suite; branches need real Atlas
                'lib/db.js',
                // sanctioned console shim, no branching logic
                'lib/logger.js',
            ],
            thresholds: {
                // T-TST-05 DoD: pragmatic floors per area (lines).
                // financial floor tracks current integration coverage;
                // behavioral money-path guarantees live in T-TST-02/03.
                'middlewares/**': { lines: 85 },
                'lib/**': { lines: 85 },
                'services/financial/**': { lines: 60 },
            },
        },
    },
});
