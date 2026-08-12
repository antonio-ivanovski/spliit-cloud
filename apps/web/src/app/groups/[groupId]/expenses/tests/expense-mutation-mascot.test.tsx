import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/test-utils'

const react = vi.hoisted(() => vi.fn())
const captured = vi.hoisted(() => ({
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
            useMutation: () => ({ mutateAsync: vi.fn() }),
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
  useDeleteExpenseMutation,
  useUpdateExpenseMutation,
} from '../expense-mutation-hooks'

function HookProbe() {
  useUpdateExpenseMutation({ linkInviteToken: undefined })
  useDeleteExpenseMutation({ linkInviteToken: undefined })
  return null
}

describe('expense mutation mascot reactions', () => {
  it('celebrates successful updates and deletes, and fails visibly', async () => {
    render(<HookProbe />)

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
    expect(react).toHaveBeenCalledWith('success')

    react.mockClear()
    captured.remove?.onError?.({ message: 'nope' })
    expect(react).toHaveBeenCalledWith('failure')
  })
})
