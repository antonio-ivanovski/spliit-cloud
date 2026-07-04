import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.gen.ts',
      'packages/db/src/generated/**',
    ],
  },
  // Base recommended config from JS
  js.configs.recommended,
  // TypeScript recommended config
  ...tseslint.configs.recommended,
  // Custom rules
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
    },
  },
  // React hooks rules + app-level dialog import policy (web only)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    rules: {
      // App code should compose dialogs through ResponsiveDialog so they
      // render as a centered modal on desktop and a bottom drawer on
      // mobile. Direct imports from the low-level primitives are reserved
      // for the responsive primitive itself, full-screen viewers (document
      // preview), command palette internals, and responsive pickers that
      // pair Drawer with a Popover (not a Dialog) on desktop.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/components/ui/dialog',
              message:
                "Use '@/components/ui/responsive-dialog' for app interactions so mobile uses a drawer and desktop uses a modal.",
            },
          ],
          patterns: [
            {
              group: ['@/components/ui/dialog'],
              message:
                "Use '@/components/ui/responsive-dialog' for app interactions so mobile uses a drawer and desktop uses a modal.",
            },
          ],
        },
      ],
    },
  },
  // Override: allow direct Dialog imports inside the approved exceptions
  {
    files: [
      'apps/web/src/components/ui/responsive-dialog.tsx',
      'apps/web/src/components/ui/command.tsx',
      'apps/web/src/components/expense-documents-input.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Override: allow direct Drawer imports for the responsive picker
  // components (Drawer + Popover pair), which are not action dialogs.
  {
    files: [
      'apps/web/src/components/currency-selector.tsx',
      'apps/web/src/components/category-selector.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/components/ui/dialog',
              message:
                "Use '@/components/ui/responsive-dialog' for app interactions so mobile uses a drawer and desktop uses a modal.",
            },
          ],
          patterns: [
            {
              group: ['@/components/ui/dialog'],
              message:
                "Use '@/components/ui/responsive-dialog' for app interactions so mobile uses a drawer and desktop uses a modal.",
            },
          ],
        },
      ],
    },
  },
)
