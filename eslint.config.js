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
            // Sprint 01 will promote these to 'error' once string throws are migrated;
            // useless-catch wrappers live in financial services rewritten by Sprint 05
            'no-throw-literal': 'warn',
            'no-useless-catch': 'warn',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
    },
];
