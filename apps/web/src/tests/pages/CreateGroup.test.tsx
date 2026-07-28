import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockCreateGroup: vi.fn(),
  mockToast: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      create: {
        useMutation: () => ({
          mutateAsync: mocks.mockCreateGroup,
        }),
      },
    },
    useUtils: () => ({
      account: {
        groups: { invalidate: vi.fn() },
      },
      invitations: {
        listForAccount: { invalidate: vi.fn() },
      },
    }),
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.mockNavigate,
}))

vi.mock('@/lib/currency', () => ({
  getCurrency: () => ({
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
  }),
  useCurrencies: () => [
    {
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
      rounding: 0,
      decimal_digits: 2,
    },
  ],
}))

vi.mock('@/components/group-form', () => ({
  GroupForm: () => <div data-testid="group-form" />,
}))

import { CreateGroup } from '@/app/groups/create/create-group'

describe('CreateGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockCreateGroup.mockResolvedValue({ groupId: 'new-group' })
  })

  it('renders the "Create a group" heading', () => {
    render(<CreateGroup />)

    expect(
      screen.getByRole('heading', { name: 'Create a group' }),
    ).toBeInTheDocument()
  })

  it('renders a back button', () => {
    render(<CreateGroup />)

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('renders the GroupForm', () => {
    render(<CreateGroup />)

    expect(screen.getByTestId('group-form')).toBeInTheDocument()
  })
})
