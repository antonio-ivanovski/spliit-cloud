import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReportPrintDialog } from '@/app/groups/[groupId]/report-print-dialog'
import { render, screen, waitFor } from '@/test/test-utils'

const mockToast = vi.fn()

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      reports: {
        bounds: { useQuery: vi.fn() },
      },
    },
  },
}))

import { trpc } from '@/trpc/client'

const boundsMock = vi.mocked(trpc.groups.reports.bounds.useQuery)

describe('ReportPrintDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToast.mockReset()
    boundsMock.mockReturnValue({
      data: { from: '2026-07-01', to: '2026-08-03' },
    } as never)
  })

  it('pre-fills defaults from the bounds query', async () => {
    render(<ReportPrintDialog groupId="grp-1" open onOpenChange={vi.fn()} />)

    const from = (await screen.findByLabelText('From')) as HTMLInputElement
    const to = screen.getByLabelText('To') as HTMLInputElement
    await waitFor(() => {
      expect(from.value).toBe('07/01/2026')
      expect(to.value).toBe('08/03/2026')
    })
  })

  it('disables opening while bounds are still loading', async () => {
    boundsMock.mockReturnValue({ data: undefined } as never)
    render(<ReportPrintDialog groupId="grp-1" open onOpenChange={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: 'Open print view' }),
    ).toBeDisabled()
  })

  it('validates the range inline and blocks opening', async () => {
    const { user } = render(
      <ReportPrintDialog groupId="grp-1" open onOpenChange={vi.fn()} />,
    )

    const from = (await screen.findByLabelText('From')) as HTMLInputElement
    await waitFor(() => expect(from.value).toBe('07/01/2026'))
    await user.clear(from)
    await user.type(from, '08/10/2026')
    await user.tab()

    expect(
      await screen.findByText(
        'The end date must be on or after the start date.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open print view' }),
    ).toBeDisabled()
  })

  it('opens the print route with the selected dates', async () => {
    const openedWindow = {} as Window
    const openMock = vi.spyOn(window, 'open').mockReturnValue(openedWindow)
    const onOpenChange = vi.fn()
    const { user } = render(
      <ReportPrintDialog groupId="grp-1" open onOpenChange={onOpenChange} />,
    )

    const from = (await screen.findByLabelText('From')) as HTMLInputElement
    await waitFor(() => expect(from.value).toBe('07/01/2026'))
    await user.click(screen.getByRole('button', { name: 'Open print view' }))

    expect(openMock).toHaveBeenCalledWith(
      '/groups/grp-1/expenses/print?from=2026-07-01&to=2026-08-03',
      '_blank',
    )
    expect(openedWindow.opener).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockToast).toHaveBeenCalledWith({
      description: 'Print report opened.',
    })
    openMock.mockRestore()
  })

  it('keeps the dialog open when the browser blocks the new tab', async () => {
    const openMock = vi.spyOn(window, 'open').mockReturnValue(null)
    const onOpenChange = vi.fn()
    const { user } = render(
      <ReportPrintDialog groupId="grp-1" open onOpenChange={onOpenChange} />,
    )

    const from = (await screen.findByLabelText('From')) as HTMLInputElement
    await waitFor(() => expect(from.value).toBe('07/01/2026'))
    await user.click(screen.getByRole('button', { name: 'Open print view' }))

    expect(mockToast).toHaveBeenCalledWith({
      description: 'Could not open the print report. Please try again.',
      variant: 'destructive',
    })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    openMock.mockRestore()
  })
})
