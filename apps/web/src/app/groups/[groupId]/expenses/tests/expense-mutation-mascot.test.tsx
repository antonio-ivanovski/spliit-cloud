import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/test-utils'

const react = vi.hoisted(() => vi.fn())
const captured = vi.hoisted(() => ({
  create: undefined as
    | {
        onSuccess?: (...args: never[]) => unknown
        onError?: (error: { message: string }) => void
      }
    | undefined,
  update: undefined as
    | {
        onSuccess?: (...args: never[]) => unknown
        onError?: (error: { data?: { code?: string }; message: string }) => void
      }
    | undefined,
  remove: undefined as
    | {
        onSuccess?: (...args: never[]) => unknown
        onError?: (error: { message: string }) => void
      }
    | undefined,
}))

vi.mock('@/components/mascot/mascot-context', () => ({
  useMascotController: () => ({ react }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/invalidate-account-groups', () => ({
  invalidateAccountGroupLists: vi.fn(async () => undefined),
}))

vi.mock('@/trpc/client', () => {
  const invalidate = vi.fn(async () => undefined)
  return {
    trpc: {
      useUtils: () => ({
        groups: {
          expenses: {
            list: { invalidate },
            get: { invalidate },
            series: { invalidate },
            commonCurrencies: { invalidate },
          },
          activities: { list: { invalidate } },
          balances: { list: { invalidate } },
        },
        overview: { get: { invalidate } },
        account: { groups: { invalidate } },
      }),
      groups: {
        expenses: {
          create: {
            useMutation: (options: (typeof captured)['create']) => {
              captured.create = options
              return { mutateAsync: vi.fn() }
            },
          },
          update: {
            useMutation: (options: (typeof captured)['update']) => {
              captured.update = options
              return { mutateAsync: vi.fn() }
            },
          },
          delete: {
            useMutation: (options: (typeof captured)['remove']) => {
              captured.remove = options
              return { mutateAsync: vi.fn() }
            },
          },
          stopRecurrence: {
            useMutation: () => ({ mutateAsync: vi.fn() }),
          },
        },
      },
    },
  }
})

import {
  useCreateExpenseMutation,
  useDeleteExpenseMutation,
  useUpdateExpenseMutation,
} from '../expense-mutation-hooks'

function HookProbe() {
  useCreateExpenseMutation({ linkInviteToken: undefined })
  useUpdateExpenseMutation({ linkInviteToken: undefined })
  useDeleteExpenseMutation({ linkInviteToken: undefined })
  return null
}

describe('expense mutation mascot reactions', () => {
  it('celebrates reimbursements, keeps create as success, and acknowledges deletes', async () => {
    render(<HookProbe />)

    await captured.create?.onSuccess?.(
      { expenseId: 'expense-1' } as never,
      {
        groupId: 'group-1',
        expense: { category: 'general' },
      } as never,
    )
    expect(react).toHaveBeenCalledWith('success')

    react.mockClear()
    await captured.create?.onSuccess?.(
      { expenseId: 'expense-2' } as never,
      {
        groupId: 'group-1',
        expense: { category: 'settlement' },
      } as never,
    )
    expect(react).toHaveBeenCalledWith('celebrate')

    react.mockClear()
    await captured.update?.onSuccess?.(
      undefined as never,
      {
        groupId: 'group-1',
        expenseId: 'expense-1',
      } as never,
    )
    expect(react).toHaveBeenCalledWith('success')

    react.mockClear()
    captured.update?.onError?.({ message: 'nope' })
    expect(react).toHaveBeenCalledWith('failure')

    react.mockClear()
    await captured.remove?.onSuccess?.(
      undefined as never,
      {
        groupId: 'group-1',
      } as never,
    )
    expect(react).toHaveBeenCalledWith('acknowledge')

    react.mockClear()
    captured.remove?.onError?.({ message: 'nope' })
    expect(react).toHaveBeenCalledWith('failure')
  })
})
