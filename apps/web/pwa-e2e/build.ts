import path from 'node:path'

import { build } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const web = path.resolve(import.meta.dirname, '..')
for (const [buildId, version] of [
  ['a', 'v1.0.0'],
  ['b', 'v1.1.0'],
]) {
  await build({
    configFile: false,
    root: path.join(web, 'pwa-e2e/fixture'),
    define: { __APP_BUILD__: JSON.stringify({ buildId, version }) },
    resolve: { alias: { '@': path.join(web, 'src') } },
    plugins: [
      {
        name: 'fixture-version',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ buildId, version }),
          })
        },
      },
      VitePWA({
        injectRegister: false,
        strategies: 'injectManifest',
        srcDir: path.join(web, 'src'),
        filename: 'sw.ts',
        manifest: false,
        injectManifest: {
          globPatterns: ['**/*.{html,js}'],
          globIgnores: ['version.json'],
        },
      }),
    ],
    build: {
      outDir: path.join(web, 'test-results/pwa-builds', buildId!),
      emptyOutDir: true,
    },
  })
}
