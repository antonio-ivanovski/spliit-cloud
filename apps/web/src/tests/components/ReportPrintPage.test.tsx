import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReportPrintPage } from '@/app/groups/[groupId]/report-print-page'
import { render, screen, waitFor } from '@/test/test-utils'

vi.mock('@/lib/api-url', () => ({
  getApiBaseUrl: () => 'http://localhost:3001',
}))

const report = {
  direction: 'ltr',
  pageSize: 'LETTER',
  title: 'Expense report',
  groupName: 'Trip to Lisbon',
  generatedOn: 'Aug 3, 2026',
  periodRange: 'Jul 1, 2026 – Jul 31, 2026',
  asOfDate: 'Jul 31, 2026',
  metrics: { total: '€30.00', expenseCount: '1', participantCount: '2' },
  participants: [
    {
      id: 'alice',
      name: 'Alice',
      paid: '€30.00',
      share: '€15.00',
      balance: '€15.00',
    },
    {
      id: 'bob',
      name: 'Bob',
      paid: '€0.00',
      share: '€15.00',
      balance: '-€15.00',
    },
  ],
  settlements: [{ from: 'Bob', to: 'Alice', amount: '€15.00' }],
  reimbursements: [],
  expenses: [
    {
      id: 'e1',
      date: 'Jul 10, 2026',
      title: 'Dinner',
      category: 'Food',
      amount: '€30.00',
      payers: [{ id: 'alice', name: 'Alice', amount: '€30.00' }],
      shares: [
        { id: 'alice', name: 'Alice', amount: '€15.00' },
        { id: 'bob', name: 'Bob', amount: '€15.00' },
      ],
      conversionNote: null,
    },
  ],
} as const

describe('ReportPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.title = 'Spliit Cloud'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(report),
    }) as unknown as typeof fetch
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('renders the compact report and keeps split participants on separate lines', async () => {
    render(
      <ReportPrintPage groupId="grp-1" from="2026-07-01" to="2026-07-31" />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Trip to Lisbon' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Participant summary')).toBeInTheDocument()
    expect(screen.getByText('Suggested settlements')).toBeInTheDocument()
    expect(screen.getByText('Expense details')).toBeInTheDocument()
    expect(screen.queryByText('Category breakdown')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('print-report-page-letter')

    const splitCell = screen.getByRole('cell', {
      name: 'Alice €15.00 Bob €15.00',
    })
    expect(splitCell.querySelectorAll('li')).toHaveLength(2)
    expect(splitCell.querySelectorAll('li')[0]).toHaveTextContent('Alice')
    expect(splitCell.querySelectorAll('li')[1]).toHaveTextContent('Bob')
  })

  it('sets a representative browser print document title', async () => {
    render(
      <ReportPrintPage groupId="grp-1" from="2026-07-01" to="2026-07-31" />,
    )

    await screen.findByRole('heading', { name: 'Trip to Lisbon' })

    expect(document.title).toBe(
      'Spliit Cloud - Trip to Lisbon - Expense report (2026-07-01 to 2026-07-31)',
    )
  })

  it('requests the selected report range and opens the browser print dialog', async () => {
    const printMock = window.print as unknown as ReturnType<typeof vi.fn>
    render(
      <ReportPrintPage groupId="grp-1" from="2026-07-01" to="2026-07-31" />,
    )

    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1))
    const [url, options] = (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/groups/grp-1/expenses/report-data')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('include')
    expect(JSON.parse(options.body as string)).toMatchObject({
      from: '2026-07-01',
      to: '2026-07-31',
      locale: 'en-US',
    })
  })
})
