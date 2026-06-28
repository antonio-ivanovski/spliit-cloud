import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { GroupForm, type Props } from '@/components/group-form'
import { useCurrencies, getCurrency } from '@/lib/currency'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/components/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/currency', () => ({
  getCurrency: vi.fn(),
  useCurrencies: vi.fn(),
}))

// ── Fixtures ────────────────────────────────────────────────────────────

const defaultCurrencies = [
  { code: 'USD', symbol: '$', rounding: 0, decimal_digits: 2, name: 'US Dollar' },
  { code: 'EUR', symbol: '€', rounding: 0, decimal_digits: 2, name: 'Euro' },
]

const mockGroup = {
  id: 'group-1',
  slug: 'test-group',
  name: 'Test Group',
  information: 'A test group',
  archived: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ledgerId: 'ledger-1',
  currency: '$',
  currencyCode: 'USD',
  ledger: {
    id: 'ledger-1',
    currency: '$',
    currencyCode: 'USD',
    groupId: 'group-1',
  },
  members: [],
  invitations: [],
  participants: [
    { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
    { id: 'lp-2', name: 'Bob', pending: false, unlinked: false },
  ],
}

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(useCurrencies).mockReturnValue(defaultCurrencies)
  vi.mocked(getCurrency).mockImplementation(
    (code: string) =>
      defaultCurrencies.find((c) => c.code === code) ?? {
        code: '',
        symbol: '',
        rounding: 0,
        decimal_digits: 2,
      },
  )
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('GroupForm', () => {
  it('renders form with name, currency, and info fields in create mode', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    // All three main fields should be present
    expect(screen.getByText('Group name')).toBeInTheDocument()
    expect(screen.getByText('Group information', { selector: 'label' })).toBeInTheDocument()

    // Currency selector trigger (combobox) should be present
    expect(screen.getByRole('combobox')).toBeInTheDocument()

    // Create button should be present in create mode
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('renders the Members tab hint when creating and hideInviteHint is false', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    // The hint paragraph contains the inviteAfterCreate message
    expect(
      screen.getByText(/open the Members tab/i),
    ).toBeInTheDocument()
  })

  it('hides the Members tab hint when hideInviteHint is true', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} hideInviteHint />)

    expect(
      screen.queryByText(/open the Members tab/i),
    ).not.toBeInTheDocument()
  })

  it('renders read-only when currentMemberRole is MEMBER', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        currentMemberRole="MEMBER"
        onSubmit={onSubmit}
      />,
    )

    // Read-only note should be visible
    expect(
      screen.getByText(/only owners and admins/i),
    ).toBeInTheDocument()

    // Name input should be disabled
    expect(screen.getByRole('textbox', { name: /name/i })).toBeDisabled()

    // Save button should NOT be present
    expect(
      screen.queryByRole('button', { name: /save|create/i }),
    ).not.toBeInTheDocument()
  })

  it('renders archived state with all inputs disabled', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        archived
        onSubmit={onSubmit}
      />,
    )

    // Archived notice should be visible
    expect(
      screen.getByText(/this group is archived/i),
    ).toBeInTheDocument()

    // Name input should be disabled
    expect(screen.getByRole('textbox', { name: /name/i })).toBeDisabled()

    // Save button should NOT be present
    expect(
      screen.queryByRole('button', { name: /save|create/i }),
    ).not.toBeInTheDocument()
  })

  it('submit calls onSubmit with parsed form values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    // Fill in the name field (required, min 2 chars)
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    await user.clear(nameInput)
    await user.type(nameInput, 'My Vacation')

    // Click Create button
    const createButton = screen.getByRole('button', { name: /create/i })
    await user.click(createButton)

    // Wait for onSubmit to be called
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    // Verify the submitted values
    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).toHaveProperty('name', 'My Vacation')
    expect(submittedValues).toHaveProperty('participants')
    expect(submittedValues.participants).toHaveLength(1)
  })

  it('submit does NOT call onSubmit when readonly', async () => {
    const onSubmit = vi.fn()
    const { user } = render(
      <GroupForm
        group={mockGroup as Props['group']}
        currentMemberRole="MEMBER"
        onSubmit={onSubmit}
      />,
    )

    // The form's handleSubmit returns early for read-only
    // Verify no save button exists
    expect(
      screen.queryByRole('button', { name: /save|create/i }),
    ).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('currency selector renders as a combobox', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('edit mode pre-fills group data', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm group={mockGroup as Props['group']} onSubmit={onSubmit} />,
    )

    // Name field should be pre-filled
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    expect(nameInput).toHaveValue('Test Group')

    // Save button should be present (not Create)
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })
})
