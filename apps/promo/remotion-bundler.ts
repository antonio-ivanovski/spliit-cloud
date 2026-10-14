import path from 'node:path'

import type { BundlerOverrideFn } from '@remotion/bundler'
import { enableTailwind } from '@remotion/tailwind-v4'

/** Shared by programmatic exports and the optional Studio. */
export const overrideBundler: BundlerOverrideFn = (configuration) => {
  const alias = configuration.resolve?.alias
  const aliases = Array.isArray(alias)
    ? Object.fromEntries(
        alias.map((entry) => [
          entry.onlyModule ? `${entry.name}$` : entry.name,
          entry.alias,
        ]),
      )
    : alias
  return enableTailwind({
    ...configuration,
    resolve: {
      ...configuration.resolve,
      alias: {
        ...aliases,
        '@web': path.resolve(import.meta.dirname, '../web/src'),
        '@': path.resolve(import.meta.dirname, '../web/src'),
        react: path.dirname(require.resolve('react/package.json')),
        'react-dom': path.dirname(require.resolve('react-dom/package.json')),
      },
    },
  })
}
