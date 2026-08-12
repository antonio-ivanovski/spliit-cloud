import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/test-utils'

const react = vi.hoisted(() => vi.fn())
const captured = vi.hoisted(() => ({
  archive: undefined as
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

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      groups: {
        get: { invalidate: vi.fn(async () => undefined) },
        invalidate: vi.fn(async () => undefined),
      },
    }),
    groups: {
      archive: {
        useMutation: (options: (typeof captured)['archive']) => {
          captured.archive = options
          return { mutateAsync: vi.fn() }
        },
      },
      delete: {
        useMutation: (options: (typeof captured)['remove']) => {
          captured.remove = options
          return { mutateAsync: vi.fn() }
        },
      },
      update: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
  },
}))

import {
  useArchiveGroupMutation,
  useDeleteGroupMutation,
} from './edit-group-mutations'

function HookProbe() {
  useArchiveGroupMutation({ onUnsettledBalances: () => undefined })
  useDeleteGroupMutation()
  return null
}

describe('group mutation mascot reactions', () => {
  it('acknowledges archive and delete, and stays quiet on unarchive', async () => {
    render(<HookProbe />)

    await captured.archive?.onSuccess?.(
      undefined as never,
      {
        groupId: 'group-1',
        archived: true,
      } as never,
    )
    expect(react).toHaveBeenCalledWith('acknowledge')

    react.mockClear()
    await captured.archive?.onSuccess?.(
      undefined as never,
      {
        groupId: 'group-1',
        archived: false,
      } as never,
    )
    expect(react).not.toHaveBeenCalled()

    react.mockClear()
    await captured.remove?.onSuccess?.(undefined as never)
    expect(react).toHaveBeenCalledWith('acknowledge')
  })
})
