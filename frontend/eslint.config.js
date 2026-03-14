import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import vitest from '@vitest/eslint-plugin';
import testingLibrary from 'eslint-plugin-testing-library';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores (replaces ignorePatterns)
  {
    ignores: ['dist/', '*.config.ts', '*.config.js'],
  },

  // Base recommended configs
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  // Main config for all TS/TSX source files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh.plugin,
    },
    rules: {
      // React hooks — only the two classic rules (v7 adds React Compiler rules
      // that aren't relevant until React 19)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Prevent unused imports and variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
        },
      ],
      'no-unused-vars': 'off',

      // React Refresh rules
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // TypeScript specific
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Ensure all Promises are handled
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',

      // Strict null checks (disabled — too many false positives in existing code)
      '@typescript-eslint/strict-boolean-expressions': 'off',

      // Disallow console.* in production code (use proper logging/error tracking)
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ── Timezone enforcement ──────────────────────────────────────────
      // Ban raw Date display methods — use utils/dateFormatting.ts instead.
      // For numbers use formatNumber() / formatCurrency() from the same module.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message:
            'Use formatDateTime() or formatNumber() from @/utils/dateFormatting instead of .toLocaleString(). See CLAUDE.md § Date/Time Display Rules.',
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message:
            'Use formatDate() or formatDateCustom() from @/utils/dateFormatting instead of .toLocaleDateString().',
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleTimeString']",
          message:
            'Use formatTime() from @/utils/dateFormatting instead of .toLocaleTimeString().',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'date-fns',
              message:
                'Import from @/utils/dateFormatting instead. Direct date-fns usage bypasses timezone conversion.',
            },
          ],
        },
      ],
    },
  },

  // Exempt date formatting utilities from the locale-method ban (they ARE the
  // canonical wrappers) and from the date-fns import restriction.
  {
    files: [
      'src/utils/dateFormatting.ts',
      'src/hooks/useRelativeTime.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // Test file overrides
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/test/**/*',
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    plugins: {
      vitest,
    },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      'no-console': 'off',

      // Vitest test quality rules
      'vitest/expect-expect': 'warn',
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-standalone-expect': 'error',
      'vitest/prefer-called-with': 'warn',
      'vitest/no-restricted-matchers': [
        'error',
        {
          toBeTruthy:
            'Avoid toBeTruthy — use toBe(true), toBeTypeOf(), or a more specific assertion',
          toBeFalsy:
            'Avoid toBeFalsy — use toBe(false), toBeNull(), toBeUndefined(), or a more specific assertion',
        },
      ],
    },
  },

  // Testing Library rules for component tests
  {
    files: ['src/**/*.test.tsx', 'src/**/*.spec.tsx'],
    ...testingLibrary.configs['flat/react'],
    rules: {
      ...testingLibrary.configs['flat/react'].rules,
      // Downgrade structural rules to warn — these require incremental refactoring
      // from DOM traversal (querySelector) to accessible queries (getByRole, etc.)
      'testing-library/no-node-access': 'warn',
      'testing-library/no-container': 'warn',
      'testing-library/no-wait-for-multiple-assertions': 'warn',
      'testing-library/prefer-presence-queries': 'warn',
    },
  },

  // Prettier must be last to override conflicting rules
  eslintConfigPrettier,
);
