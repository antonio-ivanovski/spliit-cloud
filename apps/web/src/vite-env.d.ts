/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_BUILD__: { buildId: string; version: string }

interface ImportMetaEnv {
  readonly VITE_STATUS_PAGE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
