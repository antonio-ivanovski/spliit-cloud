import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RecurringActionsMenu,
  type RecurringDeleteOption,
} from '@/app/groups/[groupId]/expenses/recurring-actions-menu'
import { render, screen, waitFor } from '@/test/test-utils'

function mockDesktopMediaQuery() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

describe('RecurringActionsMenu', () => {
  afterEach(() => vi.restoreAllMocks())

  it('makes all three deletion scopes explicit before confirmation', async () => {
    mockDesktopMediaQuery()
    const { user } = render(
      <RecurringActionsMenu
        onEdit={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onStop={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('button', { name: /recurring actions/i }))

    expect(
      screen.getByRole('button', { name: /delete only this occurrence/i }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', {
        name: /delete this and following occurrences/i,
      })[0],
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /delete this and following occurrences and stop recurrence/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^stop recurrence$/i }),
    ).toBeInTheDocument()
  })

  it('confirms the stop-recurrence deletion choice and sends its mode', async () => {
    mockDesktopMediaQuery()
    const onDelete = vi
      .fn<(_: RecurringDeleteOption) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { user } = render(
      <RecurringActionsMenu
        onEdit={vi.fn()}
        onDelete={onDelete}
        onStop={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('button', { name: /recurring actions/i }))
    await user.click(
      screen.getByRole('button', {
        name: /delete this and following occurrences and stop recurrence/i,
      }),
    )

    expect(
      screen.getByRole('heading', { name: /confirm deletion/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/will be deleted and the recurrence will stop/i),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith('THIS_AND_FUTURE_STOP'),
    )
  })

  it('keeps stop recurrence as a separate confirmed action', async () => {
    mockDesktopMediaQuery()
    const onStop = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <RecurringActionsMenu
        onEdit={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onStop={onStop}
      />,
    )

    await user.click(screen.getByRole('button', { name: /recurring actions/i }))
    await user.click(screen.getByRole('button', { name: /^stop recurrence$/i }))
    expect(
      screen.getByRole('heading', { name: /stop this recurrence/i }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /stop recurrence/i }))
    await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1))
  })

  it('hides stop-related actions when the series is CANCELLED', async () => {
    mockDesktopMediaQuery()
    const { user } = render(
      <RecurringActionsMenu
        onEdit={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onStop={vi.fn().mockResolvedValue(undefined)}
        seriesStatus="CANCELLED"
      />,
    )

    await user.click(screen.getByRole('button', { name: /recurring actions/i }))

    expect(
      screen.queryByRole('button', { name: /^stop recurrence$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /delete this and following occurrences and stop recurrence/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /delete only this occurrence/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /edit this occurrence/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /edit this and future occurrences/i }),
    ).toBeInTheDocument()
    const deleteThisAndFuture = screen.getAllByRole('button', {
      name: /delete this and following occurrences/i,
    })
    expect(deleteThisAndFuture.length).toBeGreaterThan(0)
    await user.click(deleteThisAndFuture[0])
    expect(screen.getByText(/recurrence will continue/i)).toBeInTheDocument()
  })

  it('hides stop-related actions when the series is COMPLETED', async () => {
    mockDesktopMediaQuery()
    const { user } = render(
      <RecurringActionsMenu
        onEdit={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onStop={vi.fn().mockResolvedValue(undefined)}
        seriesStatus="COMPLETED"
      />,
    )

    await user.click(screen.getByRole('button', { name: /recurring actions/i }))

    expect(
      screen.queryByRole('button', { name: /^stop recurrence$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /delete this and following occurrences and stop recurrence/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /delete only this occurrence/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /edit this occurrence/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /edit this and future occurrences/i }),
    ).toBeInTheDocument()
    const deleteThisAndFuture = screen.getAllByRole('button', {
      name: /delete this and following occurrences/i,
    })
    expect(deleteThisAndFuture.length).toBeGreaterThan(0)
    await user.click(deleteThisAndFuture[0])
    expect(screen.getByText(/recurrence will continue/i)).toBeInTheDocument()
  })
})
