import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicViewOnlyLinkSection } from './group-view-link-card'

const enable = vi.fn()
const replace = vi.fn()
const remove = vi.fn()
let result: { url: string | null; canManage: boolean }

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ groups: { view: { get: { invalidate: vi.fn() } } } }),
    groups: {
      view: {
        get: {
          useQuery: () => ({ data: result, isLoading: false }),
        },
        enable: {
          useMutation: () => ({ mutate: enable, isPending: false }),
        },
        replace: {
          useMutation: () => ({ mutate: replace, isPending: false }),
        },
        remove: {
          useMutation: () => ({ mutate: remove, isPending: false }),
        },
      },
    },
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
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

  it('lets an admin enable the public link', async () => {
    renderSection()
    expect(screen.getByText('description')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'enable' }))
    expect(enable).toHaveBeenCalledWith({ groupId: 'group-1' })
  })

  it('lets a regular member copy but not manage the current link', () => {
    result = {
      url: 'https://spliit.test/groups/group-1#view=secret',
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

  it('confirms replacement in a modal', async () => {
    result = {
      url: 'https://spliit.test/groups/group-1#view=secret',
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
  })
})
