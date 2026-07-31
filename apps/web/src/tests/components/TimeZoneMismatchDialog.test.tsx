import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TimeZoneMismatchDialog } from '@/components/time-zone-mismatch-dialog'
import {
  detectDeviceTimeZone,
  hasKeptTimeZoneMismatch,
  keepTimeZoneMismatch,
  timeZoneMismatchDecisionKey,
} from '@/lib/account-preferences'

function differentTimeZone() {
  return detectDeviceTimeZone() === 'UTC' ? 'Europe/Paris' : 'UTC'
}

describe('TimeZoneMismatchDialog', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('resolves matching canonical zones without prompting', () => {
    const onStatusChange = vi.fn()
    render(
      <TimeZoneMismatchDialog
        accountId="account-a"
        accountTimeZone={detectDeviceTimeZone()}
        enabled
        patchPreferences={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    )

    expect(
      screen.queryByTestId('time-zone-mismatch-dialog'),
    ).not.toBeInTheDocument()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      checked: true,
      promptActive: false,
    })
  })

  it('requires Keep current or Update timezone to resolve a mismatch', async () => {
    const user = userEvent.setup()
    const accountTimeZone = differentTimeZone()
    const onStatusChange = vi.fn()
    const patchPreferences = vi.fn()
    render(
      <TimeZoneMismatchDialog
        accountId="account-a"
        accountTimeZone={accountTimeZone}
        enabled
        patchPreferences={patchPreferences}
        onStatusChange={onStatusChange}
      />,
    )

    expect(screen.getByTestId('time-zone-mismatch-dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('time-zone-mismatch-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^keep /i }))

    expect(
      screen.queryByTestId('time-zone-mismatch-dialog'),
    ).not.toBeInTheDocument()
    expect(
      hasKeptTimeZoneMismatch(
        'account-a',
        accountTimeZone,
        detectDeviceTimeZone(),
      ),
    ).toBe(true)
    expect(patchPreferences).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      checked: true,
      promptActive: false,
    })
  })

  it('updates immediately and only closes after a successful save', async () => {
    const user = userEvent.setup()
    const patchPreferences = vi.fn().mockResolvedValue(true)
    render(
      <TimeZoneMismatchDialog
        accountId="account-a"
        accountTimeZone={differentTimeZone()}
        enabled
        patchPreferences={patchPreferences}
        onStatusChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^update to /i }))

    expect(patchPreferences).toHaveBeenCalledWith(
      { timeZone: detectDeviceTimeZone() },
      { optimistic: false },
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('time-zone-mismatch-dialog'),
      ).not.toBeInTheDocument(),
    )
  })

  it('stays open and reports an error when saving fails', async () => {
    const user = userEvent.setup()
    render(
      <TimeZoneMismatchDialog
        accountId="account-a"
        accountTimeZone={differentTimeZone()}
        enabled
        patchPreferences={vi.fn().mockResolvedValue(false)}
        onStatusChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^update to /i }))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('time-zone-mismatch-dialog')).toBeInTheDocument()
  })

  it('synchronizes Keep current across tabs and clears it after zones match', async () => {
    const accountTimeZone = differentTimeZone()
    const browserTimeZone = detectDeviceTimeZone()
    const props = {
      accountId: 'account-a',
      enabled: true,
      patchPreferences: vi.fn(),
      onStatusChange: vi.fn(),
    }
    const view = render(
      <TimeZoneMismatchDialog {...props} accountTimeZone={accountTimeZone} />,
    )
    expect(screen.getByTestId('time-zone-mismatch-dialog')).toHaveAttribute(
      'data-open',
    )

    keepTimeZoneMismatch('account-a', accountTimeZone, browserTimeZone)
    fireEvent(
      window,
      new StorageEvent('storage', {
        key: timeZoneMismatchDecisionKey('account-a'),
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('time-zone-mismatch-dialog'),
      ).not.toBeInTheDocument(),
    )

    view.rerender(
      <TimeZoneMismatchDialog {...props} accountTimeZone={browserTimeZone} />,
    )
    await waitFor(() =>
      expect(
        hasKeptTimeZoneMismatch('account-a', accountTimeZone, browserTimeZone),
      ).toBe(false),
    )
  })
})
