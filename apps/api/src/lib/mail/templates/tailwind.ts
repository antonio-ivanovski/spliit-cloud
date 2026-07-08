import { pixelBasedPreset } from '@react-email/components'

/**
 * Shared Tailwind config for every email in this package.
 *
 * - `pixelBasedPreset` ensures all utility classes use px values — most
 *   email clients do not honour `rem` units, so `text-base` would not
 *   resolve to a visible size.
 * - Brand colours are derived from the web app's CSS palette
 *   (`apps/web/src/app/globals.css`) so the emails visually match the
 *   product. The web primary is `hsl(163 94% 24%)` ≈ `#04785b`.
 */
export const tailwindConfig = {
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      colors: {
        brand: '#04785b',
        'brand-soft': '#e6f6f1',
        ink: '#0f172a',
        muted: '#64748b',
        divider: '#e5e7eb',
        surface: '#f1f5f9',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
}
