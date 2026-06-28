/**
 * Integration test utilities.
 *
 * For integration tests that hit the real API, use these helpers.
 * Import and use the real TRPCProvider, and mock auth at the hook
 * level (bypassing better-auth but letting through real tRPC calls).
 */

import { ThemeProvider } from '@/components/theme-provider'
import { I18nProvider } from '@/i18n/react'
import { TRPCProvider } from '@/trpc/client'
import {
  cleanup,
  render as rtlRender,
  type RenderOptions,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactElement } from 'react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

/** Full provider stack for integration tests — includes real TRPCProvider. */
function IntegrationTestProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <TRPCProvider>{children}</TRPCProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

type CustomRenderOptions = Omit<RenderOptions, 'wrapper'>

function render(ui: ReactElement, options?: CustomRenderOptions) {
  return {
    user: userEvent.setup(),
    ...rtlRender(ui, { wrapper: IntegrationTestProviders, ...options }),
  }
}

export * from '@testing-library/react'
export { render, userEvent }
