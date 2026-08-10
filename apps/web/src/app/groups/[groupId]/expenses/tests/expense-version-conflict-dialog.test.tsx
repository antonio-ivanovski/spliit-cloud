import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { ExpenseVersionConflictDialog } from '../expense-version-conflict-dialog'

describe('ExpenseVersionConflictDialog', () => {
  it('keeps the local draft without reloading', async () => {
    const onKeepDraft = vi.fn()
    const onReload = vi.fn()
    const { user } = render(
      <ExpenseVersionConflictDialog
        open
        onKeepDraft={onKeepDraft}
        onReload={onReload}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Keep my draft' }))
    expect(onKeepDraft).toHaveBeenCalledTimes(1)
    expect(onReload).not.toHaveBeenCalled()
  })

  it('reloads only when explicitly requested', async () => {
    const onKeepDraft = vi.fn()
    const onReload = vi.fn(async () => undefined)
    const { user } = render(
      <ExpenseVersionConflictDialog
        open
        onKeepDraft={onKeepDraft}
        onReload={onReload}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Reload latest' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onKeepDraft).not.toHaveBeenCalled()
  })
})
