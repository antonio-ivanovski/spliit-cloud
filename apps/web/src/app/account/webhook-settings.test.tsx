import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  endpoints: [] as Array<Record<string, unknown>>,
  listInvalidate: vi.fn(),
  testMutate: vi.fn(),
  rotateMutate: vi.fn(),
  deleteMutateAsync: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  redeliverMutate: vi.fn(),
  redeliverError: null as Error | null,
  toast: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      webhooks: { list: { invalidate: mocks.listInvalidate } },
    }),
    webhooks: {
      list: {
        useQuery: () => ({
          data: mocks.endpoints,
          isPending: false,
          isError: false,
        }),
      },
      test: {
        useMutation: () => ({ mutate: mocks.testMutate, isPending: false }),
      },
      rotateSecret: {
        useMutation: () => ({ mutate: mocks.rotateMutate, isPending: false }),
      },
      delete: {
        useMutation: () => ({
          mutateAsync: mocks.deleteMutateAsync,
          isPending: false,
        }),
      },
      create: {
        useMutation: () => ({ mutate: mocks.createMutate, isPending: false }),
      },
      update: {
        useMutation: () => ({ mutate: mocks.updateMutate, isPending: false }),
      },
      deliveries: {
        useQuery: () => ({ data: { deliveries: [] }, isPending: false }),
      },
      delivery: {
        useQuery: () => ({ data: null }),
      },
      redeliver: {
        useMutation: () => ({
          mutate: mocks.redeliverMutate,
          isPending: false,
        }),
      },
    },
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

import '@testing-library/jest-dom/vitest'
import { WebhookSettings } from './webhook-settings'

function makeEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh_1',
    accountId: 'acct_1',
    name: 'Automation service',
    url: 'https://example.com/hooks',
    enabled: true,
    notifyCreated: true,
    notifyUpdated: false,
    notifyDeleted: true,
    involvedOnly: false,
    secretVersion: 1,
    lastSuccessAt: null,
    lastFailureAt: null,
    createdAt: '2026-09-18T14:00:00.000Z',
    updatedAt: '2026-09-18T14:00:00.000Z',
    latestDelivery: null,
    ...overrides,
  }
}

describe('WebhookSettings endpoint row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.endpoints = [makeEndpoint()]
  })

  it('shows a labeled event group with only subscribed event types', () => {
    render(<WebhookSettings />)

    expect(screen.getByText('Events:')).toBeInTheDocument()
    expect(screen.getByText('Expense created')).toBeInTheDocument()
    expect(screen.getByText('Expense deleted')).toBeInTheDocument()
    expect(screen.queryByText('Expense updated')).not.toBeInTheDocument()
  })

  it('shows an enabled badge for enabled endpoints', () => {
    render(<WebhookSettings />)

    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Disable Automation service' }),
    ).not.toBeInTheDocument()
  })

  it('shows a disabled badge for disabled endpoints', () => {
    mocks.endpoints = [makeEndpoint({ enabled: false })]
    render(<WebhookSettings />)

    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })

  it('links to the webhook docs in the section header', () => {
    render(<WebhookSettings />)

    const link = screen.getByRole('link', { name: 'Docs' })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/antonio-ivanovski/spliit-cloud/blob/main/docs/webhooks.md',
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows an involved-only badge when the filter is on', () => {
    mocks.endpoints = [makeEndpoint({ involvedOnly: true })]
    render(<WebhookSettings />)

    expect(screen.getByText('Involved only')).toBeInTheDocument()
  })
})

describe('WebhookSettings delete confirmation', () => {
  beforeEach(() => {
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
    mocks.deleteMutateAsync.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openDeleteConfirm() {
    const { user } = render(<WebhookSettings />)
    await user.click(screen.getByRole('button', { name: 'Webhook actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete webhook' }))
    return user
  }

  it('asks for confirmation before deleting instead of deleting immediately', async () => {
    await openDeleteConfirm()

    expect(
      screen.getByRole('heading', { name: 'Delete webhook' }),
    ).toBeInTheDocument()
    expect(mocks.deleteMutateAsync).not.toHaveBeenCalled()
  })

  it('deletes after confirming', async () => {
    const user = await openDeleteConfirm()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteMutateAsync).toHaveBeenCalledWith({
      endpointId: 'wh_1',
    })
  })

  it('cancels without deleting', async () => {
    const user = await openDeleteConfirm()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.deleteMutateAsync).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { name: 'Delete webhook' }),
    ).not.toBeInTheDocument()
  })
})
