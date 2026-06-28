import { ThemeProvider } from '@/components/theme-provider'
import { I18nProvider } from '@/i18n/react'
import { cleanup, render as rtlRender, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactElement } from 'react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// ── Query client ────────────────────────────────────────────────────────

function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

// ── Provider stack ──────────────────────────────────────────────────────

function TestProviders({ children }: { children: React.ReactNode }) {
  const queryClient = makeTestQueryClient()

  return (
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

// ── Custom render ───────────────────────────────────────────────────────

type CustomRenderOptions = Omit<RenderOptions, 'wrapper'>

function render(ui: ReactElement, options?: CustomRenderOptions) {
  return {
    user: userEvent.setup(),
    ...rtlRender(ui, { wrapper: TestProviders, ...options }),
  }
}

// ── Re-export everything ────────────────────────────────────────────────

export { render }
export { default as userEvent } from '@testing-library/user-event'
export * from '@testing-library/react'
