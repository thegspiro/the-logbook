import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import vitest from '@vitest/eslint-plugin';
import testingLibrary from 'eslint-plugin-testing-library';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Blocking browser dialogs, banned outright (CLAUDE.md pitfall #16).
 *
 * A browser may suppress `window.confirm` / `alert` / `prompt` — Chrome does it
 * for repeated dialogs and cross-origin frames, and iOS and Firefox offer the
 * user a "prevent this page from creating further dialogs" checkbox. Once
 * suppressed, `confirm` returns `false` and `prompt` returns `null`: the exact
 * values Cancel produces. The action then silently does nothing, with no error
 * and no clue as to why, which is indistinguishable from the user declining.
 *
 * `useConfirm()` and `PromptDialog` are the replacements. This lives in the
 * lint config rather than in review discipline because the ban held across 58
 * call sites and then regressed anyway: `FacilitiesSettingsPage` reintroduced
 * `window.confirm` on 2026-08-27 and nothing caught it, since — unlike the
 * repo's other documented invariants — this one had no automated enforcement.
 *
 * It takes two rules, because the dialogs are reachable by two shapes of
 * expression and a selector that matches one is blind to the other:
 *
 *   - `no-restricted-syntax` covers the qualified forms — `window.confirm`,
 *     and equally `globalThis.confirm` and `self.confirm`, which are the same
 *     function under different global aliases.
 *   - `no-restricted-globals` covers the bare form, `confirm(...)`. A syntax
 *     selector must NOT be used for this one: the correct pattern destructures
 *     a local binding of the same name (`const { confirm } = useConfirm()`),
 *     so a bare-identifier selector would flag all 58 legitimate call sites.
 *     `no-restricted-globals` resolves scope, so it fires only when the name
 *     is genuinely the browser global and stays silent on the local binding.
 */
const noBlockingBrowserDialogs = [
  {
    selector:
      'CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name=/^(confirm|alert|prompt)$/]',
    message:
      'A suppressed confirm/alert/prompt is indistinguishable from Cancel. Use useConfirm() from @/contexts/ConfirmContext, or PromptDialog from @/components/ux. See CLAUDE.md pitfall #16.',
  },
];

const blockingDialogGlobals = ['confirm', 'alert', 'prompt'].map((name) => ({
  name,
  message: `A suppressed ${name}() is indistinguishable from Cancel. Use useConfirm() from @/contexts/ConfirmContext, or PromptDialog from @/components/ux. See CLAUDE.md pitfall #16.`,
}));

export default tseslint.config(
  // Global ignores (replaces ignorePatterns)
  {
    // `scripts/` holds build-time Node utilities and `public/` holds the
    // service-worker script pulled in via importScripts — neither is app
    // source, so both sit outside tsconfig.eslint.json's project and the
    // type-aware rules cannot resolve them. Same reason *.config.* is here.
    ignores: [
      'dist/',
      'coverage/',
      // Playwright writes a self-contained HTML application and trace assets.
      // They are generated output, not project source; linting after an E2E run
      // otherwise walks bundled JavaScript without our typed parser settings.
      'playwright-report/',
      'test-results/',
      'blob-report/',
      'scripts/',
      'public/',
      // Stryker copies the whole project into a sandbox per run and leaves it
      // behind if the run is interrupted. It is gitignored, but ESLint still
      // walks it — and it contains a second tsconfig, so typescript-eslint
      // cannot resolve a root and reports a parse error on every file. One
      // abandoned sandbox turned `npm run lint` into 1,164 phantom errors.
      '.stryker-tmp/',
      'reports/',
      '*.config.ts',
      '*.config.js',
    ],
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
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

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
          message: 'Use formatTime() from @/utils/dateFormatting instead of .toLocaleTimeString().',
        },
        ...noBlockingBrowserDialogs,
      ],
      'no-restricted-globals': ['error', ...blockingDialogGlobals],
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
    files: ['src/utils/dateFormatting.ts', 'src/hooks/useRelativeTime.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noBlockingBrowserDialogs],
      'no-restricted-imports': 'off',
    },
  },

  // Test file overrides
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx', 'src/test/**/*'],
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
      // DISABLED, and it must stay disabled. This rule is auto-fixable: it
      // rewrites `expect(m).toHaveBeenCalled()` into
      // `expect(m).toHaveBeenCalledWith()` — the ZERO-ARGUMENT form — without
      // looking at how the mock was actually called. lint-staged runs
      // `eslint --fix` on every commit, so the rewrite happened silently, and
      // for any mock called with arguments it converts a passing assertion into
      // a failing one:
      //
      //   const m = vi.fn(); m(1, 2);
      //   expect(m).toHaveBeenCalled();      // passes
      //   -- eslint --fix -->
      //   expect(m).toHaveBeenCalledWith();  // FAILS: expected call with []
      //
      // That is the mechanism behind pitfall #13, which CLAUDE.md records as
      // the single largest source of broken tests here (34 of 46). The cause
      // was never developers choosing the wrong matcher — the toolchain was
      // rewriting the right one on its way into the commit. It also directly
      // contradicts the documented rule, which says to use
      // `toHaveBeenCalled()` when arguments are not the point; with this rule
      // on, that advice was impossible to follow.
      'vitest/prefer-called-with': 'off',
      'vitest/no-restricted-matchers': [
        'error',
        {
          toBeTruthy: 'Avoid toBeTruthy — use toBe(true), toBeTypeOf(), or a more specific assertion',
          toBeFalsy: 'Avoid toBeFalsy — use toBe(false), toBeNull(), toBeUndefined(), or a more specific assertion',
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
  eslintConfigPrettier
);
