import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountDeletionPage } from '@/app/account/account-deletion-page'
import { AccountDeletionSettings } from '@/app/account/account-deletion-settings'
import {
  act,
  render as renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'

// Keep the real router around the page so internal navigation is exercised,
// while the existing API mocks focus these tests on deletion behavior.
function render(ui: ReactElement) {
  const root = createRootRoute()
  const routeTree = root.addChildren(
    [
      '/account/delete',
      '/account/settings',
      '/feedback',
      '/groups/$groupId',
    ].map((path) => createRoute({ getParentRoute: () => root, path })),
  )
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/account/delete'] }),
  })
  const wrap = (element: ReactElement) => (
    <RouterContextProvider router={router}>{element}</RouterContextProvider>
  )
  const view = renderWithProviders(wrap(ui))
  return {
    ...view,
    router,
    rerender: (element: ReactElement) => view.rerender(wrap(element)),
  }
}

const mocks = vi.hoisted(() => ({
  useCurrentAccount: vi.fn(),
  deletionStatus: vi.fn(),
  deletionPreview: vi.fn(),
  overview: vi.fn(),
  overviewRefetch: vi.fn(),
  requestMutate: vi.fn(),
  cancelMutate: vi.fn(),
  toast: vi.fn(),
  sessionFresh: vi.fn(),
  reauthenticate: vi.fn(),
  requestOptions: null as {
    onSuccess: () => Promise<void>
    onError: (cause: unknown) => void
  } | null,
  cancelOptions: null as {
    onSuccess: () => Promise<void>
    onError: (cause: unknown) => void
  } | null,
  requestPending: false,
  statusRefetch: vi.fn(),
  previewRefetch: vi.fn(),
}))

vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.useCurrentAccount,
}))

vi.mock('@/lib/passkey', async (importOriginal) => ({
  ...(await importOriginal()),
  getPasskeySessionFreshness: (...args: unknown[]) =>
    mocks.sessionFresh(...args),
  signOutAndReturnToSignIn: mocks.reauthenticate,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      account: {
        deletionStatus: { invalidate: vi.fn() },
        deletionPreview: { invalidate: vi.fn() },
      },
    }),
    overview: { get: { useQuery: () => mocks.overview() } },
    account: {
      deletionStatus: { useQuery: () => mocks.deletionStatus() },
      deletionPreview: { useQuery: () => mocks.deletionPreview() },
      requestDeletion: {
        useMutation: (options: {
          onSuccess: () => Promise<void>
          onError: (cause: unknown) => void
        }) => {
          mocks.requestOptions = options
          return {
            mutate: mocks.requestMutate,
            isPending: mocks.requestPending,
          }
        },
      },
      cancelDeletion: {
        useMutation: (options: {
          onSuccess: () => Promise<void>
          onError: (cause: unknown) => void
        }) => {
          mocks.cancelOptions = options
          return { mutate: mocks.cancelMutate, isPending: false }
        },
      },
    },
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

const accountFixture = {
  id: 'account-1',
  name: 'Current Name',
  email: 'user@example.com',
  emailVerified: true,
  image: null,
  isAnonymous: false,
}

const previewFixture = {
  displayName: 'Current Name',
  email: 'user@example.com',
  signInMethods: ['Password', 'Google'],
  groups: [
    {
      groupId: 'g1',
      name: 'Trip',
      groupType: 'GROUP',
      role: 'MEMBER',
      isLastAdmin: false,
      isLastActiveMember: false,
      hasUnsettledBalance: true,
      willDeleteGroup: false,
    },
    {
      groupId: 'g2',
      name: 'Solo',
      groupType: 'GROUP',
      role: 'ADMIN',
      isLastAdmin: true,
      isLastActiveMember: true,
      hasUnsettledBalance: false,
      willDeleteGroup: true,
    },
    {
      groupId: 'g3',
      name: 'Dana',
      groupType: 'FRIEND',
      role: 'ADMIN',
      isLastAdmin: false,
      isLastActiveMember: false,
      hasUnsettledBalance: false,
      willDeleteGroup: false,
    },
  ],
  pendingSentInvitations: 1,
  request: null,
}

const overviewFixture = {
  groups: [
    {
      id: 'g1',
      access: 'MEMBER',
      color: 'blue',
      emoji: '🏖️',
      archived: false,
      preference: { hidden: false },
      ledger: { currency: '$', currencyCode: 'USD' },
      financialSummary: { netBalance: -1250 },
    },
    {
      id: 'g2',
      access: 'MEMBER',
      color: null,
      emoji: '',
      archived: true,
      preference: { hidden: true },
      ledger: { currency: '€', currencyCode: 'EUR' },
      financialSummary: { netBalance: 0 },
    },
    {
      id: 'g3',
      access: 'MEMBER',
      friendAccount: { id: 'dana', name: 'Dana Rivers', image: null },
      color: null,
      emoji: '',
      archived: false,
      preference: { hidden: false },
      ledger: { currency: '€', currencyCode: 'EUR' },
      financialSummary: { netBalance: 2300 },
    },
    { id: 'overview-only', name: 'Unrelated saved view', access: 'VIEW_ONLY' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestPending = false
  mocks.useCurrentAccount.mockReturnValue({
    data: accountFixture,
    isPending: false,
  })
  mocks.overview.mockReturnValue({
    data: overviewFixture,
    isPending: false,
    isError: false,
    refetch: mocks.overviewRefetch,
  })
  mocks.sessionFresh.mockResolvedValue(true)
  mocks.deletionStatus.mockReturnValue({
    data: { request: null },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: mocks.statusRefetch,
  })
  mocks.deletionPreview.mockReturnValue({
    data: previewFixture,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: mocks.previewRefetch,
  })
})

async function openReview() {
  await screen.findByRole('heading', { name: 'Your choices' })
}

async function openConfirmation(user: ReturnType<typeof render>['user']) {
  if (
    !screen
      .getByRole('checkbox', { name: /i understand/i })
      .hasAttribute('data-checked')
  ) {
    await user.click(screen.getByRole('checkbox', { name: /i understand/i }))
  }
  await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
  return screen.findByRole('dialog')
}

describe('Account deletion page and settings entry', () => {
  it('shows the pending banner with a cancel action when deletion is scheduled', async () => {
    mocks.deletionStatus.mockReturnValue({
      data: {
        request: {
          executeAt: new Date('2026-09-24T12:00:00Z'),
          keepDisplayName: false,
        },
      },
      isPending: false,
      isError: false,
    })
    const { user } = render(<AccountDeletionPage />)

    expect(screen.getByText('Account deletion scheduled')).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', {
      name: /cancel deletion/i,
    })
    await user.click(cancelButton)
    expect(mocks.cancelMutate).toHaveBeenCalledTimes(1)
  })

  it.each([AccountDeletionPage, AccountDeletionSettings])(
    'shows execution without review or cancellation controls',
    async (Component) => {
      mocks.deletionStatus.mockReturnValue({
        data: {
          request: {
            executeAt: new Date(),
            keepDisplayName: true,
            status: 'EXECUTING',
          },
        },
        isPending: false,
        isError: false,
      })
      render(<Component />)
      expect(
        await screen.findByRole('heading', {
          name: 'Account deletion has started',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/deletion cannot be cancelled or undone/),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /cancel deletion/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /schedule deletion/i }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('radio')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/you can cancel beforehand/),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/you can cancel beforehand/),
      ).not.toBeInTheDocument()
    },
  )

  it.each([
    ['Back to settings', '/account/settings', '#account-deletion'],
    ['Export a backup', '/account/settings', '#account-export'],
    ['share your feedback', '/feedback', ''],
    ['Keep my account', '/account/settings', '#account-deletion'],
    ['Trip', '/groups/g1', ''],
  ])('navigates %s through the app router', async (name, pathname, hash) => {
    const { user, router } = render(<AccountDeletionPage />)
    await openReview()
    await user.click(screen.getByRole('link', { name: new RegExp(name, 'i') }))
    await waitFor(() => {
      expect(router.history.location.pathname).toBe(pathname)
      expect(router.history.location.hash).toBe(hash)
    })
  })

  it('opens the deletion review from settings through the app router', async () => {
    const { user, router } = render(<AccountDeletionSettings />)
    await router.navigate({ to: '/account/settings' })
    await user.click(screen.getByRole('link', { name: /delete account/i }))
    await waitFor(() =>
      expect(router.history.location.pathname).toBe('/account/delete'),
    )
  })

  it('shows the farewell block with a feedback link', async () => {
    render(<AccountDeletionPage />)
    await openReview()

    expect(
      screen.getByRole('heading', { name: 'Delete account' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /feedback/i })).toHaveAttribute(
      'href',
      '/feedback',
    )
  })

  it('shows all group consequences without expanding sections', async () => {
    render(<AccountDeletionPage />)
    await openReview()
    expect(screen.getByText('Solo')).toBeInTheDocument()
    expect(screen.getByText('Trip')).toBeInTheDocument()
    expect(
      screen.getByText('Remaining balances stay as they are.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Your balance stays as it is.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'These sign-in methods will stop working: Password and Google.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'When deletion runs, 1 pending invitation you sent will be revoked.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Your account stays active until deletion starts/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Groups, members, and expenses can change before deletion starts/,
      ),
    ).toBeInTheDocument()

    for (const [name, id] of [
      ['Trip', 'g1'],
      ['Solo', 'g2'],
      ['Dana', 'g3'],
    ]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'href',
        `/groups/${id}`,
      )
    }
    expect(screen.getByText(/You owe/)).toHaveTextContent('$12.50')
    expect(screen.getByText(/You are owed/)).toHaveTextContent('€23.00')
    expect(screen.getByText('Settled up')).toBeInTheDocument()
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByText('🏖️')).toBeInTheDocument()
    expect(screen.getByText('DR')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated saved view')).not.toBeInTheDocument()
  })

  it('updates archived and live balance consequences without changing current amounts', async () => {
    mocks.overview.mockReturnValue({
      data: {
        groups: overviewFixture.groups.map((group) =>
          group.id === 'g3' ? { ...group, archived: true } : group,
        ),
      },
      isPending: false,
      isError: false,
    })
    mocks.deletionPreview.mockReturnValue({
      data: {
        ...previewFixture,
        groups: previewFixture.groups.map((group) =>
          group.groupId === 'g3'
            ? { ...group, hasUnsettledBalance: true }
            : group,
        ),
      },
      isPending: false,
      isError: false,
    })
    const { user } = render(<AccountDeletionPage />)
    await openReview()
    await user.click(
      screen.getByRole('radio', { name: /mark balances settled/i }),
    )
    const archivedRow = screen
      .getByRole('link', { name: 'Dana' })
      .closest('li')!
    expect(archivedRow).toHaveTextContent(
      'When deletion runs, your then-current balance will be marked settled and the ledger closed.',
    )
    expect(archivedRow).toHaveTextContent('€23.00')
    expect(archivedRow).not.toHaveTextContent('recorded')
    expect(
      screen.getByRole('link', { name: 'Trip' }).closest('li'),
    ).toHaveTextContent('marked settled')
    expect(screen.getByText(/You owe/)).toHaveTextContent('$12.50')
  })

  it('retries supporting group data and never presents an unavailable balance as zero', async () => {
    mocks.overview.mockReturnValue({ isPending: true, isError: false })
    const { rerender, user } = render(<AccountDeletionPage />)
    await openReview()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getAllByText('Balance unavailable')).toHaveLength(3)
    mocks.overview.mockReturnValue({
      isPending: false,
      isError: true,
      refetch: mocks.overviewRefetch,
    })
    rerender(<AccountDeletionPage />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.overviewRefetch).toHaveBeenCalledOnce()
    mocks.overview.mockReturnValue({
      data: { groups: [overviewFixture.groups[0]] },
      isPending: false,
      isError: false,
    })
    rerender(<AccountDeletionPage />)
    expect(screen.getByText(/You owe/)).toHaveTextContent('$12.50')
    expect(screen.getAllByText('Balance unavailable')).toHaveLength(2)
  })

  it('hides sections with no groups', async () => {
    mocks.deletionPreview.mockReturnValue({
      data: { ...previewFixture, groups: [previewFixture.groups[0]] },
      isPending: false,
      isError: false,
    })
    render(<AccountDeletionPage />)
    await openReview()

    expect(
      screen.getByRole('heading', { name: /Groups you will leave/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Groups that will be deleted'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Friends to settle up with'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Friends')).not.toBeInTheDocument()
  })

  it('links to settings, backup, and feedback from the page', async () => {
    render(<AccountDeletionPage />)
    await openReview()
    expect(
      screen.getByRole('link', { name: /back to settings/i }),
    ).toHaveAttribute('href', '/account/settings#account-deletion')
    expect(
      screen.getByRole('link', { name: /export a backup/i }),
    ).toHaveAttribute('href', '/account/settings#account-export')
  })

  it('requires acknowledgement, then typed confirmation in the dialog', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()
    expect(screen.queryByLabelText(/enter the name/i)).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: /schedule deletion/i })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.requestMutate).not.toHaveBeenCalled()
    const dialog = await openConfirmation(user)
    const schedule = within(dialog).getByRole('button', {
      name: /schedule deletion/i,
    })
    await user.type(within(dialog).getByLabelText(/enter the name/i), 'DELET')
    expect(within(dialog).getByText(/doesn’t match/i)).toBeInTheDocument()
    expect(schedule).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/enter the name/i), 'E')
    expect(schedule).toBeEnabled()
  })

  it('clears confirmation on dismissal while preserving choices and returning focus', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()
    await user.click(
      screen.getByRole('radio', { name: /mark balances settled/i }),
    )
    const dialog = await openConfirmation(user)
    await user.type(within(dialog).getByLabelText(/enter the name/i), 'DELETE')
    await user.click(
      within(dialog).getByRole('button', { name: /keep my account/i }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('radio', { name: /mark balances settled/i }),
    ).toBeChecked()
    expect(
      screen.getByRole('button', { name: /schedule deletion/i }),
    ).toHaveFocus()
    const reopened = await openConfirmation(user)
    expect(within(reopened).getByLabelText(/enter the name/i)).toHaveValue('')
    expect(
      within(reopened).getByRole('button', { name: /schedule deletion/i }),
    ).toBeDisabled()
    expect(mocks.requestMutate).not.toHaveBeenCalled()
  })

  it('schedules deletion with the account email and name preference', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()

    await user.click(screen.getByRole('radio', { name: /replace my name/i }))
    await openConfirmation(user)
    await user.type(screen.getByLabelText(/enter the name/i), 'DELETE')
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    await waitFor(() => {
      expect(mocks.requestMutate).toHaveBeenCalledWith({
        email: 'user@example.com',
        keepDisplayName: false,
        displayName: undefined,
        settleBalances: false,
      })
    })
  })

  it('sends the edited remnant name when the name is kept', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()

    const nameInput = screen.getByLabelText(/name to keep/i)
    expect(nameInput).toHaveValue('Current Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Al Remembered')
    expect(
      screen.getByText(
        'When deletion runs, shared expenses will show “Al Remembered”. Your profile name stays unchanged until then.',
      ),
    ).toBeInTheDocument()

    await openConfirmation(user)
    await user.type(screen.getByLabelText(/enter the name/i), 'DELETE')
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    await waitFor(() => {
      expect(mocks.requestMutate).toHaveBeenCalledWith({
        email: 'user@example.com',
        keepDisplayName: true,
        displayName: 'Al Remembered',
        settleBalances: false,
      })
    })
  })

  it('rejects a blank remnant name instead of silently falling back', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()

    await user.clear(screen.getByLabelText(/name to keep/i))
    await user.click(screen.getByText(/i understand this is permanent/i))
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    expect(
      await screen.findByText('Enter a name between 1 and 100 characters.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/name to keep/i)).toHaveFocus()
    expect(mocks.requestMutate).not.toHaveBeenCalled()
  })

  it('switches balance copy when settling is opted in', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()

    await user.click(
      screen.getByRole('radio', { name: /mark balances settled/i }),
    )
    expect(
      screen.getByText('The balance at deletion time will be marked settled.'),
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        'When deletion runs, your then-current balance will be marked settled and the ledger closed.',
      ),
    ).toBeInTheDocument()
  })

  it('renders the invite plural correctly for one and many', async () => {
    render(<AccountDeletionPage />)
    await openReview()
    expect(
      screen.getByText(
        'When deletion runs, 1 pending invitation you sent will be revoked.',
      ),
    ).toBeInTheDocument()
  })

  it('renders the invite plural for many invitations', async () => {
    mocks.deletionPreview.mockReturnValue({
      data: { ...previewFixture, pendingSentInvitations: 6 },
      isPending: false,
      isError: false,
    })
    render(<AccountDeletionPage />)
    await openReview()
    expect(
      screen.getByText(
        'When deletion runs, 6 pending invitations you sent will be revoked.',
      ),
    ).toBeInTheDocument()
  })
  it('navigates from settings to the dedicated page', () => {
    render(<AccountDeletionSettings />)
    expect(
      screen.getByRole('link', { name: /delete account/i }),
    ).toHaveAttribute('href', '/account/delete')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('requires fresh sign-in before editing and invokes reauthentication', async () => {
    mocks.sessionFresh.mockResolvedValue(false)
    const { user } = render(<AccountDeletionPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Sign in again' }),
    )
    expect(mocks.reauthenticate).toHaveBeenCalledOnce()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(mocks.requestMutate).not.toHaveBeenCalled()
  })

  it('offers a retry when status cannot be loaded', async () => {
    mocks.deletionStatus.mockReturnValue({
      isError: true,
      isPending: false,
      refetch: mocks.statusRefetch,
    })
    const { user } = render(<AccountDeletionPage />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.statusRefetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('offers a retry when the preview cannot be loaded', async () => {
    mocks.deletionPreview.mockReturnValue({
      isError: true,
      isPending: false,
      refetch: mocks.previewRefetch,
    })
    const { user } = render(<AccountDeletionPage />)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(mocks.previewRefetch).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: /schedule deletion/i }),
    ).not.toBeInTheDocument()
  })

  it('shows an explicit empty groups state', async () => {
    mocks.deletionPreview.mockReturnValue({
      data: { ...previewFixture, groups: [] },
    })
    render(<AccountDeletionPage />)
    await openReview()
    expect(
      screen.getByText('You are not a member of any group.'),
    ).toBeInTheDocument()
  })
  it('replaces the review with scheduled status, then resets choices after cancellation', async () => {
    const { user, rerender } = render(<AccountDeletionPage />)
    await openReview()
    await user.click(screen.getByRole('radio', { name: /replace my name/i }))
    await user.click(
      screen.getByRole('radio', { name: /mark balances settled/i }),
    )
    await openConfirmation(user)
    await user.type(screen.getByLabelText(/enter the name/i), 'DELETE')
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    mocks.deletionStatus.mockReturnValue({
      data: { request: { executeAt: new Date('2026-10-07T12:00:00Z') } },
      isSuccess: true,
    })
    await act(async () => {
      await mocks.requestOptions!.onSuccess()
    })
    expect(screen.getByText('Account deletion scheduled')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel deletion/i }))
    expect(mocks.cancelMutate).toHaveBeenCalledOnce()
    mocks.deletionStatus.mockReturnValue({
      data: { request: null },
      isSuccess: true,
    })
    await act(async () => {
      await mocks.cancelOptions!.onSuccess()
    })
    rerender(<AccountDeletionPage />)
    await openReview()
    expect(screen.getByRole('radio', { name: /keep my name/i })).toBeChecked()
    expect(
      screen.getByRole('radio', { name: /keep remaining balances/i }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /i understand/i }),
    ).not.toBeChecked()
    expect(screen.queryByLabelText(/enter the name/i)).not.toBeInTheDocument()
  })

  it('replaces an expired-session review with inline reauthentication', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()
    await openConfirmation(user)
    await user.type(screen.getByLabelText(/enter the name/i), 'DELETE')
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    const cause = Object.assign(new Error('Session is not fresh'), {
      data: { code: 'PRECONDITION_FAILED' },
    })
    await act(async () => {
      mocks.requestOptions!.onError(cause)
    })
    expect(
      screen.getByRole('button', { name: 'Sign in again' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/enter the name/i)).not.toBeInTheDocument()
  })

  it('freezes choices and prevents duplicate scheduling while a request is pending', async () => {
    const { user, rerender } = render(<AccountDeletionPage />)
    await openReview()
    await openConfirmation(user)
    await user.type(screen.getByLabelText(/enter the name/i), 'DELETE')
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    mocks.requestPending = true
    rerender(<AccountDeletionPage />)
    expect(screen.getByLabelText(/name to keep/i)).toBeDisabled()
    expect(screen.getByLabelText(/replace my name/i)).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /scheduling/i }))
    expect(mocks.requestMutate).toHaveBeenCalledOnce()
  })
  it('shows loading without enabling the review before status resolves', async () => {
    mocks.deletionStatus.mockReturnValue({ isPending: true })
    render(<AccountDeletionPage />)
    expect(
      screen.getByLabelText('Loading deletion details'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /schedule deletion/i }),
    ).not.toBeInTheDocument()
  })

  it('shows scheduling failures beside the confirmation action', async () => {
    const { user } = render(<AccountDeletionPage />)
    await openReview()
    await openConfirmation(user)
    await user.type(screen.getByLabelText(/enter the name/i), 'DELETE')
    await user.click(screen.getByRole('button', { name: /schedule deletion/i }))
    await act(async () => {
      mocks.requestOptions!.onError(new Error('Failed request'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again.',
    )
    expect(screen.getByRole('dialog')).toContainElement(
      screen.getByRole('alert'),
    )
  })
})
