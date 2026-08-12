import { Plus } from 'lucide-react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import {
  MascotProvider,
  useMascotActions,
  useMascotController,
  type MascotAction,
} from '@/components/mascot/mascot-context'
import { MascotHost } from '@/components/mascot/mascot-host'
import { markMascotSettingsDiscovered } from '@/components/mascot/mascot-settings-discovery'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'

const state = vi.hoisted(() => ({
  pathname: '/',
  mascot: 'bill' as 'bill' | 'off',
  navigate: vi.fn(),
  groupAction: vi.fn(),
  isPending: false,
  account: { id: 'account-1', name: 'Ada' } as {
    id: string
    name: string
  } | null,
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
    data: state.account,
    isPending: state.isPending,
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

function CelebrateButton() {
  const mascot = useMascotController()
  return (
    <button type="button" onClick={() => mascot.react('success', 5_000)}>
      Celebrate
    </button>
  )
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
    state.isPending = false
    state.account = { id: 'account-1', name: 'Ada' }
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => vi.useRealTimers())

  it('stays absent until Bill is selected', () => {
    state.mascot = 'off'
    renderHost()

    expect(screen.queryByTestId('bill-mascot-trigger')).toBeNull()
  })

  it('still renders while the account session is pending', () => {
    state.isPending = true
    state.account = null
    renderHost()

    expect(
      screen.getByRole('button', { name: 'Open actions with Bill' }),
    ).toBeInTheDocument()
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

  it('keeps the same trigger node when the route changes', () => {
    const { rerender } = renderHost()
    const trigger = screen.getByTestId('bill-mascot-trigger')

    state.pathname = '/feedback'
    rerender(
      <MascotProvider>
        <MascotHost />
      </MascotProvider>,
    )

    expect(screen.getByTestId('bill-mascot-trigger')).toBe(trigger)
  })

  it('becomes personality-only on routes without a contextual action', async () => {
    state.pathname = '/feedback'
    const { user } = renderHost()

    const trigger = screen.getByRole('button', { name: 'Say hello to Bill' })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('data-reaction', 'success')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('explains the missing action after a second tap', async () => {
    state.pathname = '/feedback'
    const { user } = renderHost()

    const trigger = screen.getByRole('button', { name: 'Say hello to Bill' })
    await user.click(trigger)
    await user.click(trigger)

    expect(screen.getByTestId('bill-mascot-speech')).toHaveTextContent(
      'Nothing I can help with here right now.',
    )
  })

  it('does not nag with the speech bubble again this session', () => {
    vi.useFakeTimers()
    state.pathname = '/feedback'
    renderHost()

    const trigger = screen.getByRole('button', { name: 'Say hello to Bill' })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.getByTestId('bill-mascot-speech')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.queryByTestId('bill-mascot-speech')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByTestId('bill-mascot-speech')).toBeNull()
    vi.useRealTimers()
  })

  it('offers a settings action until it is used', async () => {
    const { user } = renderHost()

    await user.click(
      screen.getByRole('button', { name: 'Open actions with Bill' }),
    )
    await user.click(screen.getByTestId('bill-mascot-settings'))

    expect(state.navigate).toHaveBeenCalledWith({
      to: '/account/settings',
      hash: 'account-preference-mascot',
    })
    expect(screen.queryByTestId('bill-mascot-settings')).toBeNull()
  })

  it('hides the settings action after the mascot preference is changed', async () => {
    const { user } = renderHost()

    await user.click(
      screen.getByRole('button', { name: 'Open actions with Bill' }),
    )
    expect(screen.getByTestId('bill-mascot-settings')).toBeInTheDocument()

    markMascotSettingsDiscovered('account-1')
    await waitFor(() => {
      expect(screen.queryByTestId('bill-mascot-settings')).toBeNull()
    })
  })

  it('sits behind an open modal without docking', async () => {
    renderHost()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)

    await waitFor(() => {
      expect(screen.getByTestId('bill-mascot')).toHaveAttribute(
        'data-mascot-blocked',
        'true',
      )
    })
    expect(screen.queryByTestId('bill-mascot-docked')).toBeNull()
    expect(screen.getByTestId('bill-mascot-trigger')).toBeInTheDocument()

    dialog.remove()
  })

  it('docks on focused form routes but stays clickable', async () => {
    state.pathname = '/groups/create'
    const { user } = renderHost()

    expect(screen.getByTestId('bill-mascot-docked')).toBeInTheDocument()
    const trigger = screen.getByTestId('bill-mascot-trigger')
    expect(trigger).toHaveAttribute('aria-label', 'Say hello to Bill')

    await user.click(trigger)
    await user.click(trigger)
    expect(screen.getByTestId('bill-mascot-speech')).toBeInTheDocument()
  })

  it('explains the missing action on settings after two taps', async () => {
    state.pathname = '/account/settings'
    const { user } = renderHost()

    const trigger = screen.getByRole('button', { name: 'Say hello to Bill' })
    await user.click(trigger)
    await user.click(trigger)

    expect(screen.getByTestId('bill-mascot-speech')).toHaveTextContent(
      'Nothing I can help with here right now.',
    )
  })

  it('undocks and rises above an overlay while celebrating', async () => {
    state.pathname = '/groups/create'
    const { user } = renderHost(<CelebrateButton />)

    expect(screen.getByTestId('bill-mascot-docked')).toBeInTheDocument()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)

    await waitFor(() => {
      expect(screen.getByTestId('bill-mascot-docked')).toHaveAttribute(
        'data-mascot-blocked',
        'true',
      )
    })

    await user.click(screen.getByRole('button', { name: 'Celebrate' }))

    const host = screen.getByTestId('bill-mascot')
    expect(host).toHaveAttribute('data-mascot-docked', 'false')
    expect(host).toHaveAttribute('data-mascot-blocked', 'false')
    expect(host).toHaveAttribute('data-reaction', 'success')
    expect(host.className).toContain('z-70')

    dialog.remove()
  })

  it('lifts above a fixed action bar on all breakpoints', async () => {
    renderHost()

    const bar = document.createElement('div')
    bar.setAttribute('data-fixed-action-bar', '')
    document.body.append(bar)

    await waitFor(() => {
      const host = screen.getByTestId('bill-mascot')
      expect(host.className).toContain(
        'bottom-[calc(4.65rem+env(safe-area-inset-bottom))]',
      )
      expect(host.className).not.toContain('sm:bottom-5')
    })

    bar.remove()
  })
})
