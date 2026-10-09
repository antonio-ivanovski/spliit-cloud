import { defineConfig } from 'oxfmt'

export default defineConfig({
  printWidth: 80,
  semi: false,
  singleQuote: true,
  jsdoc: true,
  sortImports: {
    internalPattern: ['@/', '@spliit/', '~/', '#'],
    partitionByComment: true,
  },
  sortPackageJson: {
    sortScripts: true,
  },
  sortTailwindcss: {
    stylesheet: './apps/web/src/app/globals.css',
    functions: ['cn', 'clsx', 'cva'],
  },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/.vitest/**',
    // Playwright exhaust: per-run storage state and failure evidence are
    // gitignored runtime artifacts, never source.
    '**/.auth/**',
    '**/test-results/**',
    '**/playwright-report/**',
    'apps/web/src/components/ui/**',
    'apps/web/src/routeTree.gen.ts',
    'packages/db/src/generated/**',
    'packages/domain/src/announcement-content.generated.ts',
  ],
})
