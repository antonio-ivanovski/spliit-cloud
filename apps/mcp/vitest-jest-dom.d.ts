import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

/**
 * Bridge for Vitest 5 + @testing-library/jest-dom types.
 *
 * Vitest's own docs say custom matcher types must augment `vitest.Matchers`
 * (see Extending Matchers / Migration). `@testing-library/jest-dom/vitest`
 * still augments `interface Assertion`, which no longer merges under Vitest 5's
 * chunked exports, so tsc misses `toBeInTheDocument` etc.
 *
 * Runtime still uses `import '@testing-library/jest-dom/vitest'`. Remove this
 * file when jest-dom's published vitest.d.ts augments Matchers.
 */
declare module 'vitest' {
  // Vitest 5.0.0-beta.7 still uses Matchers<T>; main docs use Matchers<R, T>.
  interface Matchers<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
}
