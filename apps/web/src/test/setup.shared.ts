import { initI18n } from '@/i18n/setup'

// ── Initialize i18n (loads en-US locale for tests) ─────────────────────
await initI18n()

// ── Stub import.meta.env defaults ──────────────────────────────────────
vi.stubGlobal('import.meta', {
  env: {
    VITE_API_URL: 'http://localhost:3001',
    VITE_ENABLE_GOOGLE_OAUTH: 'false',
    VITE_ENABLE_GITHUB_OAUTH: 'false',
    VITE_ENABLE_TWITTER_OAUTH: 'false',
    MODE: 'test',
    DEV: true,
    PROD: false,
  },
})
