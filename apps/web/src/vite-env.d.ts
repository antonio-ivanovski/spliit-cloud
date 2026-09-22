/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_SHA?: string
  readonly VITE_STATUS_PAGE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
