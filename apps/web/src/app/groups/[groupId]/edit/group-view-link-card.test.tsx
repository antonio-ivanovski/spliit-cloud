import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicViewOnlyLinkSection } from './group-view-link-card'

const enable = vi.fn()
const replace = vi.fn()
const remove = vi.fn()
const toast = vi.fn()
let result: { url: string | null; canManage: boolean }

type MutationCallbacks = {
  onSuccess?: () => void
  onError?: (error: { message: string }) => void
}

function mutationMock(fn: (input: unknown) => void, succeed = true) {
  return (opts: MutationCallbacks) => ({
    mutate: (input: unknown) => {
      fn(input)
      if (succeed) opts.onSuccess?.()
      else opts.onError?.({ message: 'mutation failed' })
    },
    isPending: false,
  })
}

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ groups: { view: { get: { invalidate: vi.fn() } } } }),
    groups: {
      view: {
        get: {
          useQuery: () => ({ data: result, isLoading: false }),
        },
        enable: {
          useMutation: (opts: MutationCallbacks) => mutationMock(enable)(opts),
        },
        replace: {
          useMutation: (opts: MutationCallbacks) => mutationMock(replace)(opts),
        },
        remove: {
          useMutation: (opts: MutationCallbacks) => mutationMock(remove)(opts),
        },
      },
    },
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PublicViewOnlyLinkSection groupId="group-1" />
    </QueryClientProvider>,
  )
}

describe('PublicViewOnlyLinkSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    result = { url: null, canManage: true }
  })

  it('lets an admin enable the public link and toasts success', async () => {
    renderSection()
    expect(screen.getByText('description')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'enable' }))
    expect(enable).toHaveBeenCalledWith({ groupId: 'group-1' })
    expect(toast).toHaveBeenCalledWith({ description: 'enableSuccess' })
  })

  it('lets a regular member copy but not manage the current link', () => {
    result = {
      url: `https://spliit.test/groups/${'a'.repeat(32)}`,
      canManage: false,
    }
    renderSection()
    expect(screen.getByRole('textbox', { name: 'linkLabel' })).toHaveValue(
      result.url,
    )
    expect(
      screen.queryByRole('button', { name: 'replace / remove' }),
    ).toBeNull()
  })

  it('copies the URL when the link field is clicked and shows a checkmark', async () => {
    result = {
      url: 'https://spliit.test/groups/group-1?viewKey=secret',
      canManage: false,
    }
    renderSection()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    await userEvent.click(screen.getByRole('textbox', { name: 'linkLabel' }))

    expect(writeText).toHaveBeenCalledWith(result.url)
    const copyButton = screen.getByRole('button', { name: 'copy' })
    expect(copyButton.querySelector('.lucide-copy')).not.toBeInTheDocument()
    expect(copyButton.querySelector('.lucide-check')).toBeInTheDocument()
  })

  it('confirms replacement in a modal and toasts success', async () => {
    result = {
      url: `https://spliit.test/groups/${'a'.repeat(32)}`,
      canManage: true,
    }
    renderSection()
    expect(screen.getByRole('button', { name: 'replace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'remove' })).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'replace / remove' }),
    )
    await userEvent.click(screen.getByRole('menuitem', { name: 'replace' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'replaceConfirm' }),
    )
    expect(replace).toHaveBeenCalledWith({
      groupId: 'group-1',
      confirmed: true,
    })
    expect(toast).toHaveBeenCalledWith({ description: 'replaceSuccess' })
  })

  it('toasts success after removing the public link', async () => {
    result = {
      url: `https://spliit.test/groups/${'a'.repeat(32)}`,
      canManage: true,
    }
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'removeConfirm' }))
    expect(remove).toHaveBeenCalledWith({
      groupId: 'group-1',
      confirmed: true,
    })
    expect(toast).toHaveBeenCalledWith({ description: 'removeSuccess' })
  })
})
