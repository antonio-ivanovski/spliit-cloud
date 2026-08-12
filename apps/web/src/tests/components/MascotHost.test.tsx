import { Plus } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MascotProvider,
  useMascotActions,
  type MascotAction,
} from '@/components/mascot/mascot-context'
import { MascotHost } from '@/components/mascot/mascot-host'
import { render, screen, waitFor } from '@/test/test-utils'

const state = vi.hoisted(() => ({
  pathname: '/',
  mascot: 'bill' as 'bill' | 'off',
  navigate: vi.fn(),
  groupAction: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ pathname: state.pathname }),
  useNavigate: () => state.navigate,
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => ({ mascot: state.mascot }),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({
    data: { id: 'account-1', name: 'Ada' },
    isPending: false,
  }),
}))

const groupActions: MascotAction[] = [
  {
    id: 'add-expense',
    label: 'Add expense',
    icon: Plus,
    primary: true,
    onSelect: state.groupAction,
  },
]

function GroupActionRegistration() {
  useMascotActions('test-group', groupActions)
  return null
}

function renderHost(extra?: React.ReactNode) {
  return render(
    <MascotProvider>
      {extra}
      <MascotHost />
    </MascotProvider>,
  )
}

describe('MascotHost', () => {
  beforeEach(() => {
    state.pathname = '/'
    state.mascot = 'bill'
    vi.clearAllMocks()
  })

  it('stays absent until Bill is selected', () => {
    state.mascot = 'off'
    renderHost()

    expect(screen.queryByTestId('bill-mascot-trigger')).toBeNull()
  })

  it('offers the conservative creation shortcuts on home', async () => {
    const { user } = renderHost()

    await user.click(
      screen.getByRole('button', { name: 'Open actions with Bill' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Create a group' }))

    expect(state.navigate).toHaveBeenCalledWith({ to: '/groups/create' })
  })

  it('uses registered group actions instead of home shortcuts', async () => {
    state.pathname = '/groups/group-1/expenses'
    const { user } = renderHost(<GroupActionRegistration />)

    await user.click(
      screen.getByRole('button', { name: 'Open actions with Bill' }),
    )
    expect(screen.queryByRole('menuitem', { name: 'Create group' })).toBeNull()

    await user.click(screen.getByRole('menuitem', { name: 'Add expense' }))
    expect(state.groupAction).toHaveBeenCalledOnce()
  })

  it('becomes personality-only on routes without a contextual action', async () => {
    state.pathname = '/feedback'
    const { user } = renderHost()

    const trigger = screen.getByRole('button', { name: 'Say hello to Bill' })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('data-reaction', 'success')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('docks non-interactively while a modal is present', async () => {
    renderHost()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)

    await waitFor(() => {
      expect(screen.getByTestId('bill-mascot-docked')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('bill-mascot-trigger')).toBeNull()

    dialog.remove()
  })
})
