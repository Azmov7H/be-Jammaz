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
    },
});
