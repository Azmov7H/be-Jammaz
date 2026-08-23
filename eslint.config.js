import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['node_modules/**', 'docs/**'],
    },
    js.configs.recommended,
    {
        // T-SEC-05: scripts/tests use console directly (CLI output);
        // lib/logger.js is the single sanctioned console boundary.
        files: ['scripts/**/*.js', 'tests/**', 'lib/logger.js'],
        rules: {
            'no-console': 'off',
        },
    },
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // T-ARC-01: string throws migrated to AppError hierarchy (lib/errors.js)
            'no-throw-literal': 'error',
            // useless-catch wrappers live in financial services rewritten by Sprint 05
            'no-useless-catch': 'warn',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            // T-SEC-05: all app logging goes through lib/logger.js
            'no-console': 'error',
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
    },
];
