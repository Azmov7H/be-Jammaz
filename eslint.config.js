import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['node_modules/**', 'docs/**'],
    },
    js.configs.recommended,
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
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
    },
];
