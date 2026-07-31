import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDeploymentConfig } from './deployment-config'

const { mockGetFeatures } = vi.hoisted(() => ({
  mockGetFeatures: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  getTrpcClient: () => ({
    features: {
      get: {
        query: mockGetFeatures,
      },
    },
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('useDeploymentConfig', () => {
  it('loads runtime configuration from features.get', async () => {
    vi.stubEnv('MODE', 'development')
    mockGetFeatures.mockResolvedValue({
      enableExpenseDocuments: false,
      enableReceiptExtract: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
      defaultCurrencyCode: 'EUR',
      enableGoogleOAuth: true,
      enableGitHubOAuth: false,
    })

    const { result } = renderHook(() => useDeploymentConfig(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current).toEqual({
        defaultCurrencyCode: 'EUR',
        enableGoogleOAuth: true,
        enableGitHubOAuth: false,
      })
    })
    expect(mockGetFeatures).toHaveBeenCalledOnce()
  })
})
