import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { currentAccount, routeLoaderData } = vi.hoisted(() => ({
  currentAccount: vi.fn(),
  routeLoaderData: {
    token: 'signed-token',
    preview: { category: 'EXPENSE_CREATED' } as { category: string } | null,
  },
}))

vi.mock('@/components/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: currentAccount,
}))
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useLoaderData: () => routeLoaderData,
  }),
}))

import UnsubscribePage from '@/app/unsubscribe'

describe('UnsubscribePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentAccount.mockReturnValue({ data: null, isPending: false })
    window.location.hash = '#token=signed-token'
    routeLoaderData.preview = { category: 'EXPENSE_CREATED' }
  })

  it('previews the category and submits the RFC one-click form', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const user = userEvent.setup()

    render(<UnsubscribePage />)

    expect(
      screen.getByRole('heading', { name: /turn off these emails/i }),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/new expense/i).length).toBeGreaterThan(0)
    expect(
      screen.getByText(/other emails and push notifications will stay/i),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /turn off these emails/i }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/email/unsubscribe?token=signed-token'),
      expect.objectContaining({
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
      }),
    )
    expect(
      await screen.findByRole('heading', {
        name: /these emails are turned off/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      /other notification settings haven’t changed/i,
    )
    fetchMock.mockRestore()
  })

  it('shows an invalid state when the token preview fails', () => {
    routeLoaderData.preview = null
    render(<UnsubscribePage />)
    expect(
      screen.getByRole('heading', { name: /link no longer works/i }),
    ).toBeInTheDocument()
  })

  it('resets the submission state when the token fragment changes', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const user = userEvent.setup()

    const { rerender } = render(<UnsubscribePage />)
    await user.click(
      screen.getByRole('button', { name: /turn off these emails/i }),
    )
    expect(
      await screen.findByRole('heading', {
        name: /these emails are turned off/i,
      }),
    ).toBeInTheDocument()

    routeLoaderData.token = 'another-token'
    rerender(<UnsubscribePage />)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /turn off these emails/i }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('heading', {
        name: /these emails are turned off/i,
      }),
    ).not.toBeInTheDocument()
    fetchMock.mockRestore()
  })
})
