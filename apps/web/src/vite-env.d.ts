/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_SHA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
