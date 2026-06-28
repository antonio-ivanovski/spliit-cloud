import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => {
  const MockLink = ({
    to,
    children,
    search,
    params,
    ...props
  }: {
    to: string
    children: React.ReactNode
    search?: Record<string, string>
    params?: Record<string, string>
    [key: string]: unknown
  }) => {
    // Build href from to, params, and search
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace('$' + key, value)
      }
    }
    if (search) {
      const query = new URLSearchParams(search)
      href += '?' + query.toString()
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }
  return { Link: MockLink }
})

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import { ReimbursementList } from '@/app/groups/[groupId]/reimbursement-list'

// ── Helpers ──────────────────────────────────────────────────────────────

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

function makeParticipant(id: string, name: string) {
  return { id, name }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ReimbursementList', () => {
  it("shows 'no reimbursements' message when list is empty", () => {
    render(
      <ReimbursementList
        reimbursements={[]}
        participants={[]}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByTestId('no-reimbursements')).toBeInTheDocument()
    expect(
      screen.getByText(
        'It looks like your group doesn\u2019t need any reimbursement \uD83D\uDE01',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('reimbursements-list')).not.toBeInTheDocument()
  })

  it('shows reimbursement rows with from/to names', () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 1500 }]

    render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByTestId('reimbursements-list')).toBeInTheDocument()
    expect(
      screen.getByTestId('reimbursement-row-Alice-Bob'),
    ).toBeInTheDocument()
    // The "owes" text: "Alice owes Bob"
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows amount formatted in currency', () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 1500 }]

    render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    // 1500 cents = €15.00
    expect(screen.getByText('€15.00')).toBeInTheDocument()
  })

  it("shows 'Mark as paid' link with correct href search params", () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    const markAsPaid = screen.getByText('Mark as paid')
    expect(markAsPaid).toBeInTheDocument()
    // The link points to /groups/group-1/expenses/create with search params
    const link = markAsPaid.closest('a')
    expect(link).toHaveAttribute(
      'href',
      '/groups/group-1/expenses/create?reimbursement=yes&from=alice-id&to=bob-id&amount=2000',
    )
  })
})
