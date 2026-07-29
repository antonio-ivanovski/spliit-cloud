import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthLoginPage } from '@/app/oauth/oauth-login-page'
import { render, screen, waitFor } from '@/test/test-utils'

const { authState, resumeOAuthMock, searchState } = vi.hoisted(() => ({
  authState: {
    data: null as { user: { id: string } } | null,
    isPending: false,
  },
  resumeOAuthMock: vi.fn(),
  searchState: {
    oauth_query: 'client_id=assistant-client&scope=openid',
    client_id: 'assistant-client',
    scope: 'openid profile',
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => searchState,
  }),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => authState,
  },
}))

vi.mock('@/app/oauth/oauth-api', () => ({
  resolveOAuthQuery: (query?: string) => query,
  resumeOAuthAuthorization: resumeOAuthMock,
}))

vi.mock('@/components/auth/auth-panel', () => ({
  AuthPanel: ({
    embedded,
    redirectTo,
  }: {
    embedded?: boolean
    redirectTo?: string
  }) => (
    <div
      data-testid="regular-auth-panel"
      data-embedded={String(embedded)}
      data-redirect-to={redirectTo}
    />
  ),
}))

describe('OAuthLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.data = null
    authState.isPending = false
  })

  it('continues automatically when a Spliit session already exists', async () => {
    authState.data = { user: { id: 'account-1' } }

    render(<OAuthLoginPage />)

    expect(screen.getByText('Connecting your account')).toBeInTheDocument()
    expect(screen.queryByTestId('regular-auth-panel')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(resumeOAuthMock).toHaveBeenCalledWith(searchState.oauth_query),
    )
  })

  it('embeds the regular Spliit auth flow when signed out', () => {
    render(<OAuthLoginPage />)

    const panel = screen.getByTestId('regular-auth-panel')
    expect(panel).toHaveAttribute('data-embedded', 'true')
    expect(panel).toHaveAttribute(
      'data-redirect-to',
      `/oauth/login?${searchState.oauth_query}`,
    )
  })

  it('waits for session detection before showing any sign-in form', () => {
    authState.isPending = true

    render(<OAuthLoginPage />)

    expect(
      screen.getByText('Checking your Spliit session…'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('regular-auth-panel')).not.toBeInTheDocument()
  })
})
