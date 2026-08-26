import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PwaUpdateSnapshot } from '@/lib/pwa-update-manager'
import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => {
  let snapshot: PwaUpdateSnapshot = { status: 'available' }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    restartNow: vi.fn().mockResolvedValue(undefined),
    forceRestartAll: vi.fn().mockResolvedValue(undefined),
    deferUntilNextLaunch: vi.fn(),
    setSnapshot: (next: PwaUpdateSnapshot) => {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    resetSnapshot: () => {
      snapshot = { status: 'available' }
    },
  }
})

vi.mock('@/lib/pwa-update-manager', () => ({
  getPwaUpdateManager: () => mocks,
}))

import { PwaRegister } from '@/components/pwa-register'

describe('PwaRegister', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mocks.resetSnapshot()
  })

  it('offers a non-destructive choice without restarting automatically', () => {
    render(<PwaRegister />)

    expect(
      screen.getByRole('heading', { name: 'New version available' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/strongly recommended/i)).toBeInTheDocument()
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    expect(screen.getByText(/next time you launch/i)).toBeInTheDocument()
    expect(mocks.restartNow).not.toHaveBeenCalled()
  })

  it('restarts only after explicit confirmation', async () => {
    const { user } = render(<PwaRegister />)

    await user.click(screen.getByRole('button', { name: 'Restart now' }))

    expect(mocks.restartNow).toHaveBeenCalledOnce()
  })

  it('defers the update for the rest of the document session', async () => {
    const { user } = render(<PwaRegister />)

    await user.click(screen.getByRole('button', { name: 'Later' }))

    expect(mocks.deferUntilNextLaunch).toHaveBeenCalledOnce()
  })

  it('treats Escape as Later', async () => {
    const { user } = render(<PwaRegister />)

    await user.keyboard('{Escape}')

    expect(mocks.deferUntilNextLaunch).toHaveBeenCalledOnce()
  })

  it('shows the number of other clients and offers a force restart', () => {
    mocks.setSnapshot({
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })
    render(<PwaRegister />)

    expect(
      screen.getByText(/other open Spliit tabs or windows/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restart all anyway' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restart now' }),
    ).toBeInTheDocument()
  })

  it('can retry the safe client check after other windows close', async () => {
    mocks.setSnapshot({
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })
    const { user } = render(<PwaRegister />)

    await user.click(screen.getByRole('button', { name: 'Restart now' }))

    expect(mocks.restartNow).toHaveBeenCalledOnce()
    expect(mocks.forceRestartAll).not.toHaveBeenCalled()
  })

  it('requires a second confirmation before restarting every client', async () => {
    mocks.setSnapshot({
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 2,
    })
    const { user } = render(<PwaRegister />)

    await user.click(screen.getByRole('button', { name: 'Restart all anyway' }))

    expect(
      screen.getByRole('heading', { name: 'Restart every Spliit window?' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/every open Spliit tab/i)).toBeInTheDocument()
    expect(mocks.forceRestartAll).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.getByRole('button', { name: 'Restart all anyway' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restart all anyway' }))
    await user.click(screen.getByRole('button', { name: 'Restart all' }))

    expect(mocks.forceRestartAll).toHaveBeenCalledOnce()
  })

  it('offers force restart when the client check is unavailable', () => {
    mocks.setSnapshot({
      status: 'available',
      error: 'client-check',
      otherClientsBlocked: true,
    })
    render(<PwaRegister />)

    expect(screen.getByText(/couldn't verify/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restart all anyway' }),
    ).toBeInTheDocument()
  })

  it('shows client-check progress without allowing duplicate actions', () => {
    mocks.setSnapshot({ status: 'available', checkingClients: true })
    render(<PwaRegister />)

    expect(
      screen.getByRole('button', { name: 'Checking other tabs…' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
  })

  it('cannot be dismissed while the worker is checking clients', async () => {
    mocks.setSnapshot({ status: 'available', checkingClients: true })
    const { user } = render(<PwaRegister />)

    await user.keyboard('{Escape}')

    expect(mocks.deferUntilNextLaunch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'New version available' }),
    ).toBeInTheDocument()
  })

  it('shows restart progress and prevents dismissal', () => {
    mocks.setSnapshot({ status: 'restarting' })
    render(<PwaRegister />)

    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
  })

  it('surfaces a restart failure and allows another attempt', () => {
    mocks.setSnapshot({ status: 'available', error: 'restart' })
    render(<PwaRegister />)

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't restart/i)
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeEnabled()
  })

  it('offers the explicit force path after an activation timeout', () => {
    mocks.setSnapshot({
      status: 'available',
      error: 'restart',
      forceRestartAvailable: true,
    })
    render(<PwaRegister />)

    expect(
      screen.getByRole('button', { name: 'Restart all anyway' }),
    ).toBeEnabled()
  })

  it('returns from confirmation to show a force-restart failure', async () => {
    mocks.setSnapshot({
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })
    mocks.forceRestartAll.mockImplementationOnce(async () => {
      mocks.setSnapshot({
        status: 'available',
        error: 'restart',
        forceRestartAvailable: true,
      })
    })
    const { user } = render(<PwaRegister />)

    await user.click(screen.getByRole('button', { name: 'Restart all anyway' }))
    await user.click(screen.getByRole('button', { name: 'Restart all' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't restart/i)
    expect(
      screen.getByRole('heading', { name: 'New version available' }),
    ).toBeInTheDocument()
  })

  it('dismisses a force confirmation as Later when Escape closes the modal', async () => {
    mocks.setSnapshot({
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })
    const { user } = render(<PwaRegister />)
    await user.click(screen.getByRole('button', { name: 'Restart all anyway' }))

    await user.keyboard('{Escape}')

    expect(mocks.deferUntilNextLaunch).toHaveBeenCalledOnce()
  })
})
