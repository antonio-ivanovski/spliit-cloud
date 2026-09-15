import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthManualCallbackPage } from '@/app/oauth/oauth-manual-callback-page'
import { render, screen } from '@/test/test-utils'

const { searchState } = vi.hoisted(() => ({
  searchState: {
    code: 'test-code',
    state: 'test-state',
    iss: undefined,
    error: undefined,
    error_description: undefined,
  } as {
    code?: string
    state?: string
    iss?: string
    error?: string
    error_description?: string
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => searchState,
  }),
}))

describe('OAuthManualCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchState.code = 'test-code'
    searchState.state = 'test-state'
    searchState.iss = undefined
    searchState.error = undefined
    searchState.error_description = undefined
  })

  it('shows the code and copies the full page URL', async () => {
    const { user } = render(<OAuthManualCallbackPage />)
    // Spy after render because userEvent.setup() replaces navigator.clipboard
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    expect(screen.getByText('Finish connecting your agent')).toBeVisible()
    expect(screen.getByText('test-code')).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Copy connection URL' }),
    )
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(
      await screen.findByRole('button', { name: 'Copied to clipboard' }),
    ).toBeVisible()
  })

  it('renders the authorization error without anything copyable', () => {
    searchState.code = undefined
    searchState.state = undefined
    searchState.error = 'access_denied'
    searchState.error_description = 'The user denied the request.'

    render(<OAuthManualCallbackPage />)

    expect(screen.getByText('Connection did not complete')).toBeVisible()
    expect(screen.getByText('The user denied the request.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Copy connection URL' }),
    ).not.toBeInTheDocument()
  })

  it('explains how to start over when there is nothing to copy', () => {
    searchState.code = undefined
    searchState.state = undefined

    render(<OAuthManualCallbackPage />)

    expect(screen.getByText('Nothing to copy yet')).toBeVisible()
    expect(
      screen.getByText(
        'Return to your agent or app and start the connection again.',
      ),
    ).toBeVisible()
  })
})
