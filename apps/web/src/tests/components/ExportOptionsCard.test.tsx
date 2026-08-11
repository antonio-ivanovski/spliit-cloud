import { describe, expect, it, vi } from 'vitest'

import { ExportOptionsCard } from '@/app/groups/[groupId]/export-options-card'
import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockBoundsQuery: vi.fn(() => ({
    data: { from: '2026-07-01', to: '2026-08-03' },
  })),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      reports: {
        bounds: { useQuery: mocks.mockBoundsQuery },
      },
    },
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/api-url', () => ({
  getApiBaseUrl: () => 'http://localhost:3001',
}))

describe('ExportOptionsCard', () => {
  it('renders three equal-format export options with explicit actions', () => {
    render(<ExportOptionsCard groupId="grp-1" />)

    expect(
      screen.getByRole('heading', { name: 'Print / save PDF' }),
    ).toBeInTheDocument()
    expect(screen.getByText('CSV spreadsheet')).toBeInTheDocument()
    expect(screen.getByText('Spliit backup bundle')).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Print / save PDF' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Download CSV' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Download bundle' }),
    ).toBeInTheDocument()
  })

  it('keeps the CSV/bundle download URLs and target', () => {
    render(<ExportOptionsCard groupId="grp-1" />)

    const csv = screen.getByRole('link', { name: 'Download CSV' })
    expect(csv).toHaveAttribute(
      'href',
      'http://localhost:3001/groups/grp-1/expenses/export/csv',
    )
    expect(csv).toHaveAttribute('target', '_blank')

    const bundle = screen.getByRole('link', { name: 'Download bundle' })
    expect(bundle).toHaveAttribute(
      'href',
      'http://localhost:3001/groups/grp-1/export/bundle',
    )
    expect(bundle).toHaveAttribute('target', '_blank')
  })

  it('keeps export actions in a compact single-column layout', () => {
    render(<ExportOptionsCard groupId="grp-1" />)

    const grid = screen.getByTestId('export-options-grid')
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).not.toContain('md:grid-cols-3')
  })

  it('keeps card copy readable on narrow screens', () => {
    render(<ExportOptionsCard groupId="grp-1" />)

    const pdfAction = screen.getByRole('button', { name: 'Print / save PDF' })
    expect(pdfAction.className).toContain('w-full')
    expect(pdfAction.className).toContain('sm:w-auto')
    expect(
      screen.getByText(
        'Compact branded report. Use your browser to print or save it as a PDF.',
      ),
    ).toBeInTheDocument()
  })

  it('opens the report date dialog from the print action', async () => {
    const { user } = render(<ExportOptionsCard groupId="grp-1" />)

    await user.click(screen.getByRole('button', { name: 'Print / save PDF' }))

    expect(
      await screen.findByRole('heading', { name: 'Print expense report' }),
    ).toBeInTheDocument()
  })

  it('keeps actions in keyboard tab order: PDF, CSV, bundle', () => {
    render(<ExportOptionsCard groupId="grp-1" />)

    const pdf = screen.getByRole('button', { name: 'Print / save PDF' })
    const bundle = screen.getByRole('link', { name: 'Download bundle' })
    const csv = screen.getByRole('link', { name: 'Download CSV' })
    expect(
      pdf.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      bundle.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
