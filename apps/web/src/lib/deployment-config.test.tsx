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
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  })
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
      maxExpenseDocumentSize: 10 * 1024 * 1024,
      enableReceiptExtract: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
      defaultCurrencyCode: 'EUR',
      enableGoogleOAuth: true,
      enableGitHubOAuth: false,
      enableTwitterOAuth: true,
      oidcProviders: [{ id: 'oidc', name: 'Company SSO' }],
      signupMode: 'invite_only',
      allowUninvitedSignup: false,
      enableAnonymousAuth: false,
      enableEmailAuth: false,
      enablePasskeyAuth: true,
      passkeyFreshAgeSeconds: 30 * 24 * 60 * 60,
      emailDeliveryEnabled: false,
    })

    const { result } = renderHook(() => useDeploymentConfig(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current).toEqual({
        defaultCurrencyCode: 'EUR',
        enableGoogleOAuth: true,
        enableGitHubOAuth: false,
        enableTwitterOAuth: true,
        oidcProviders: [{ id: 'oidc', name: 'Company SSO' }],
        signupMode: 'invite_only',
        allowUninvitedSignup: false,
        enableAnonymousAuth: false,
        enableEmailAuth: false,
        enablePasskeyAuth: true,
        passkeyFreshAgeSeconds: 30 * 24 * 60 * 60,
        emailDeliveryEnabled: false,
        maxExpenseDocumentSize: 10 * 1024 * 1024,
      })
    })
    expect(mockGetFeatures).toHaveBeenCalledOnce()
  })

  it('uses build-time env flags when offline instead of fetching features', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('VITE_ENABLE_GOOGLE_OAUTH', 'true')
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    const { result } = renderHook(() => useDeploymentConfig(), {
      wrapper: createWrapper(),
    })

    expect(result.current.enableGoogleOAuth).toBe(true)
    expect(mockGetFeatures).not.toHaveBeenCalled()
  })

  it('reports delivery as unknown before the features query resolves', () => {
    vi.stubEnv('MODE', 'development')
    mockGetFeatures.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useDeploymentConfig(), {
      wrapper: createWrapper(),
    })

    expect(result.current.emailDeliveryEnabled).toBeNull()
    expect(mockGetFeatures).toHaveBeenCalledOnce()
  })
})
