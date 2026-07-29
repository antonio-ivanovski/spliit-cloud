import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthConsentPage } from '@/app/oauth/oauth-consent-page'
import { render, screen } from '@/test/test-utils'

const { clientMock, searchState, submitConsentMock } = vi.hoisted(() => ({
  clientMock: vi.fn(),
  searchState: {
    oauth_query: 'client_id=chatgpt&scope=openid',
    client_id: 'chatgpt',
    scope: 'openid profile email spliit:groups:read spliit:expenses:write',
  },
  submitConsentMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => searchState,
  }),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: 'account-1',
          name: 'Antonio Example',
          email: 'antonio@example.com',
          image: null,
        },
      },
      isPending: false,
    }),
  },
}))

vi.mock('@/app/oauth/oauth-api', () => ({
  getOAuthPublicClient: clientMock,
  resolveOAuthQuery: (query?: string) => query,
  submitConsent: submitConsentMock,
}))

describe('OAuthConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.mockResolvedValue({
      client_id: 'chatgpt',
      client_name: 'ChatGPT',
    })
    submitConsentMock.mockResolvedValue(undefined)
  })

  it('explains the account, client, shared data and light risk', async () => {
    render(<OAuthConsentPage />)

    expect(await screen.findByText('Connect Spliit to ChatGPT?')).toBeVisible()
    expect(screen.getByText('Antonio Example')).toBeVisible()
    expect(screen.getByText('antonio@example.com')).toBeVisible()
    expect(screen.getByText('What will be shared')).toBeVisible()
    expect(screen.getByText('Group and spending context')).toBeVisible()
    expect(screen.getByText('Confirmed expense creation')).toBeVisible()
    expect(screen.getByText('A quick privacy note')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Allow and connect' }),
    ).toBeEnabled()
  })

  it('submits the exact signed OAuth request when allowed', async () => {
    const { user } = render(<OAuthConsentPage />)

    const allow = await screen.findByRole('button', {
      name: 'Allow and connect',
    })
    await user.click(allow)

    expect(submitConsentMock).toHaveBeenCalledWith({
      accept: true,
      oauthQuery: searchState.oauth_query,
      scope: searchState.scope,
    })
  })

  it('keeps long account and client identities inside the connection panel', async () => {
    clientMock.mockResolvedValue({
      client_id: 'chatgpt',
      client_name:
        'A very long assistant client name used to validate constrained layouts',
    })

    render(<OAuthConsentPage />)

    expect(
      await screen.findByText(
        'A very long assistant client name used to validate constrained layouts',
      ),
    ).toBeVisible()
    const connectionPanel = screen.getByTestId('oauth-connection-panel')
    expect(connectionPanel).toHaveClass('min-w-0')
    expect(connectionPanel).toHaveClass('overflow-hidden')
  })
})
