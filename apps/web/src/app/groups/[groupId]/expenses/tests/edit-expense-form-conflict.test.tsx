import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { EditExpenseForm } from '../edit-expense-form'

const mocks = vi.hoisted(() => ({
  formMounts: 0,
  formVersions: [] as number[],
  expenseVersion: 3,
  onConflict: null as null | (() => void),
  refetch: vi.fn(),
  update: vi.fn(),
  restoredVersion: null as number | null,
  submit: null as ((value: never) => Promise<unknown>) | null,
}))

vi.mock('@/lib/use-expense-update-recovery', () => ({
  useExpenseUpdateRecoveryIdentity: () => ({
    key: 'edit:group-1:expense-1',
    namespace: 'account:a',
    restored:
      mocks.restoredVersion === null
        ? null
        : { expectedVersion: mocks.restoredVersion },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/use-group-access-search', () => ({
  useGroupAccessSearch: () => ({
    linkInviteToken: undefined,
    viewKey: undefined,
  }),
}))

vi.mock('../../current-group-context', () => ({
  useIsReadOnlyGroupViewer: () => false,
}))

vi.mock('../expense-mutation-hooks', () => ({
  useUpdateExpenseMutation: (options: { onConflict: () => void }) => {
    mocks.onConflict = options.onConflict
    return { mutateAsync: mocks.update }
  },
  useDeleteExpenseMutation: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('../expense-form/index', async () => {
  const { useState } = await import('react')
  return {
    ExpenseForm: ({
      expense,
      onSubmit,
    }: {
      expense: { version: number }
      onSubmit: (value: never) => Promise<unknown>
    }) => {
      mocks.submit = onSubmit
      useState(() => {
        mocks.formMounts += 1
        mocks.formVersions.push(expense.version)
        return true
      })
      return <div data-testid="expense-form-draft">Local draft</div>
    },
  }
})

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      get: {
        useQuery: () => ({
          data: {
            group: { id: 'group-1', archived: false },
            currentLedgerParticipantId: 'participant-1',
          },
        }),
      },
      expenses: {
        get: {
          useQuery: () => ({
            data: {
              expense: {
                id: 'expense-1',
                title: 'Dinner',
                version: mocks.expenseVersion,
                recurringSeries: null,
                permissions: { canEdit: true },
              },
            },
            refetch: mocks.refetch,
          }),
        },
      },
    },
  },
}))

function renderForm() {
  return render(
    <EditExpenseForm
      groupId="group-1"
      expenseId="expense-1"
      runtimeFeatureFlags={{} as never}
    />,
  )
}

describe('EditExpenseForm conflict reload', () => {
  it('keeps the original concurrency version when the server query refreshes during editing', async () => {
    const view = renderForm()
    mocks.expenseVersion = 4
    view.rerender(
      <EditExpenseForm
        groupId="group-1"
        expenseId="expense-1"
        runtimeFeatureFlags={{} as never}
      />,
    )
    await act(async () => {
      await mocks.submit?.({} as never)
    })
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 3 }),
    )
  })

  it('uses the recovered concurrency version until the user explicitly reloads latest', async () => {
    mocks.restoredVersion = 2
    mocks.refetch.mockImplementation(async () => {
      mocks.expenseVersion = 4
      return { isError: false }
    })
    const { user } = renderForm()
    await act(async () => {
      await mocks.submit?.({} as never)
    })
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 2 }),
    )
    act(() => mocks.onConflict?.())
    await user.click(screen.getByRole('button', { name: 'Reload latest' }))
    await act(async () => {
      await mocks.submit?.({} as never)
    })
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 4 }),
    )
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.formMounts = 0
    mocks.formVersions = []
    mocks.expenseVersion = 3
    mocks.onConflict = null
    mocks.restoredVersion = null
    mocks.submit = null
  })

  it('keeps the dialog and draft mounted when refetch fails', async () => {
    mocks.refetch.mockResolvedValue({ isError: true })
    const { user } = renderForm()
    act(() => mocks.onConflict?.())

    await user.click(screen.getByRole('button', { name: 'Reload latest' }))

    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeVisible()
    expect(screen.getByTestId('expense-form-draft')).toBeVisible()
    expect(mocks.formMounts).toBe(1)
  })

  it('remounts from fresh data only after a successful refetch', async () => {
    mocks.refetch.mockImplementation(async () => {
      mocks.expenseVersion = 4
      return { isError: false }
    })
    const { user } = renderForm()
    act(() => mocks.onConflict?.())

    await user.click(screen.getByRole('button', { name: 'Reload latest' }))

    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: 'Reload latest' }),
    ).not.toBeInTheDocument()
    expect(mocks.formMounts).toBe(2)
    expect(mocks.formVersions).toEqual([3, 4])
  })
})
