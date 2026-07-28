/**
 * Scalar `/docs` configuration.
 *
 * Centralizes Scalar's universal config so `app.ts` stays a wiring file. The
 * custom CSS overrides Scalar's `--scalar-color-accent` (and a few siblings)
 * with Spliit's emerald brand color so the docs don't visually clash with the
 * rest of the app.
 *
 * Brand assets (favicon, logo) live on the **web** app, not the API. Scalar's
 * `favicon` value becomes a `<link rel="icon">` in the served HTML, so the
 * browser fetches it directly from the web origin — no need to bundle copies of
 * `apps/web/public/` into the API image.
 */

import type { ApiReferenceConfiguration } from '@scalar/hono-api-reference'

import { webOrigins } from './env'

const SPLIIT_ACCENT_LIGHT = '#0CAA76'
const SPLIIT_ACCENT_DARK = '#14E1A4'

const webBaseUrl = webOrigins[0]

const CUSTOM_CSS = `
/* Spliit brand overrides — emerald accent on top of Scalar's default theme. */
:root {
  --scalar-radius: 8px;
  --scalar-font: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --scalar-font-code: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
}

.dark-mode {
  --scalar-color-accent: ${SPLIIT_ACCENT_DARK};
  --scalar-background-accent: ${SPLIIT_ACCENT_DARK}1f;
  --scalar-color-green: ${SPLIIT_ACCENT_DARK};
}

.light-mode {
  --scalar-color-accent: ${SPLIIT_ACCENT_LIGHT};
  --scalar-background-accent: ${SPLIIT_ACCENT_LIGHT}1f;
  --scalar-color-green: ${SPLIIT_ACCENT_LIGHT};
}

.light-mode .sidebar,
.dark-mode .sidebar {
  --scalar-sidebar-color-active: var(--scalar-color-accent);
  --scalar-sidebar-item-hover-color: var(--scalar-color-accent);
}

/* Deprioritise the Scalar branding link — Spliit is the brand here. */
.darklight-reference a[href*='scalar.com'] {
  opacity: 0.4;
}
`

export function buildScalarConfig(): Partial<ApiReferenceConfiguration> {
  return {
    pageTitle: 'Spliit API Reference',
    // Browser fetches this directly from the web origin — keeps the
    // API image free of bundled web assets. `webOrigins[0]` is the
    // primary web origin configured via `WEB_ORIGINS` env var. We use
    // `/logo.svg` (the same icon the web app's `<link rel="icon">`
    // references) for visual consistency.
    favicon: `${webBaseUrl}/logo.svg`,
    customCss: CUSTOM_CSS,
    // Hides the dark-mode toggle: Spliit's docs are always dark, matches
    // the web app's default. Remove `forceDarkModeState` to let users
    // pick; keep `hideDarkModeToggle` if you want a single look.
    darkMode: true,
    forceDarkModeState: 'dark',
    hideDarkModeToggle: true,
    // Scalar's hosted Agent requires an account + uploaded spec. Disabled
    // here; revisit when we add a custom OpenAI-compatible chat route.
    agent: {
      disabled: true,
    },
  }
}
