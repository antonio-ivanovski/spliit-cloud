import type * as TanStackRouter from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { ScanToJoinDialog } from './scan-to-join-dialog'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  scanCallback: null as ((result: unknown, error: unknown) => void) | null,
}))

vi.mock(
  '@tanstack/react-router',
  async (importOriginal: () => Promise<typeof TanStackRouter>) => {
    const actual = await importOriginal()
    return { ...actual, useNavigate: () => mocks.navigate }
  },
)

// The dialog lazily imports the scanner; intercept it so tests can feed fake
// scan results without a camera.
vi.mock('@zxing/browser', () => ({
  BrowserCodeReader: {
    listVideoInputDevices: async () => [],
  },
  BrowserQRCodeReader: class {
    async decodeFromVideoDevice(
      _deviceId: unknown,
      _video: unknown,
      callback: (result: unknown, error: unknown) => void,
    ) {
      mocks.scanCallback = callback
      return { stop: vi.fn() }
    }
  },
}))

const TOKEN = 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scanCallback = null
})

function renderDialog() {
  return render(<ScanToJoinDialog open onOpenChange={vi.fn()} />)
}

async function simulateScan(text: string) {
  await vi.waitFor(() => expect(mocks.scanCallback).not.toBeNull())
  mocks.scanCallback?.({ getText: () => text }, undefined)
}

describe('ScanToJoinDialog', () => {
  it('renders the scanner without a paste-link fallback', async () => {
    renderDialog()

    expect(
      screen.getByRole('heading', { name: 'Scan group QR code' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Or paste an invite link' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open invite' }),
    ).not.toBeInTheDocument()
  })

  it('rejects scanned text that is not a group invite', async () => {
    renderDialog()

    await simulateScan('https://example.com/not-an-invite')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('navigates to the group for a valid scanned invite link', async () => {
    renderDialog()
    const inviteUrl = `${window.location.origin}/groups/grp-1?invite=${TOKEN}`

    await simulateScan(inviteUrl)

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/groups/$groupId',
        params: { groupId: 'grp-1' },
        search: { invite: TOKEN },
      }),
    )
  })

  it('asks for confirmation before leaving to a foreign Spliit instance', async () => {
    const assignSpy = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => {})
    try {
      const { user } = renderDialog()
      const foreignUrl = `https://spliit.example/groups/grp-9?invite=${TOKEN}`

      await simulateScan(foreignUrl)

      // No blind redirect: an interstitial names the foreign origin.
      expect(assignSpy).not.toHaveBeenCalled()
      expect(
        await screen.findByRole('alertdialog', {
          name: 'This code points to another Spliit',
        }),
      ).toBeInTheDocument()
      expect(screen.getByText(/spliit\.example/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Go back' }))
      expect(
        screen.queryByRole('alertdialog', {
          name: 'This code points to another Spliit',
        }),
      ).not.toBeInTheDocument()
      expect(assignSpy).not.toHaveBeenCalled()

      await simulateScan(foreignUrl)
      await screen.findByRole('alertdialog', {
        name: 'This code points to another Spliit',
      })
      await user.click(screen.getByRole('button', { name: 'Open link' }))
      expect(assignSpy).toHaveBeenCalledWith(foreignUrl)
      expect(mocks.navigate).not.toHaveBeenCalled()
    } finally {
      assignSpy.mockRestore()
    }
  })

  it('ignores further scans while the foreign interstitial is open', async () => {
    const { user } = renderDialog()
    const foreignUrl = `https://spliit.example/groups/grp-9?invite=${TOKEN}`

    await simulateScan(foreignUrl)
    await screen.findByRole('alertdialog', {
      name: 'This code points to another Spliit',
    })

    // Frames keep arriving while the guest decides: no duplicate dialog and
    // no same-origin navigation slipping through underneath.
    await simulateScan(foreignUrl)
    await simulateScan(`${window.location.origin}/groups/grp-1?invite=${TOKEN}`)
    await vi.waitFor(() =>
      expect(
        screen.getAllByRole('alertdialog', {
          name: 'This code points to another Spliit',
        }),
      ).toHaveLength(1),
    )
    expect(mocks.navigate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(
      screen.queryByRole('alertdialog', {
        name: 'This code points to another Spliit',
      }),
    ).not.toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
