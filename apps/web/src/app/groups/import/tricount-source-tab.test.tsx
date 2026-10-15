import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { TricountSourceTab } from './tricount-source-tab'

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      tricountPreview: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}))

const SINGLE_CSV = [
  'Title;Amount;Currency;Exchange rate;Amount in default currency (EUR);Transaction type;Category;Paid by;Date & time;Paid by Alex;Impacted to Alex',
  'Hotel;-85.00;EUR;1;85.00;NORMAL;Housing;Alex;2018-10-16 17:46:56;85;85',
  'tricount City trip - Exported on 2024-02-05;;;;;;;',
].join('\n')

const MULTI_CSV = [
  'Title;Amount;Currency;Exchange rate;Amount in default currency (EUR);Transaction type;Category;Paid by;Date & time;Paid by Alex;Impacted to Alex',
  'Hotel;-85.00;EUR;1;85.00;NORMAL;Housing;Alex;2018-10-16 17:46:56;85;85',
  'tricount City trip - Exported on 2024-02-05;;;;;;;',
  'Title;Amount;Currency;Exchange rate;Amount in default currency (EUR);Transaction type;Category;Paid by;Date & time;Paid by Alex;Impacted to Alex',
  'Cabin;-40.00;EUR;1;40.00;NORMAL;Housing;Alex;2018-11-01 10:00:00;40;40',
  'tricount Mountain hut - Exported on 2024-02-06;;;;;;;',
].join('\n')

function upload(csv: string) {
  const file = new File([csv], 'tricount.csv', { type: 'text/csv' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  return { file, input }
}

describe('TricountSourceTab', () => {
  it('renders a guide trigger inside each path card, with steps in a dialog', async () => {
    const user = userEvent.setup()
    const view = render(
      <TricountSourceTab
        onLoaded={vi.fn()}
        onMultiLoaded={vi.fn()}
        onError={vi.fn()}
      />,
    )
    // Each trigger lives inside its own card; neither path's steps are visible upfront.
    const linkTrigger = screen.getByRole('button', {
      name: /Where do I find my Tricount share link\?/i,
    })
    const gdprTrigger = screen.getByRole('button', {
      name: /How do I request my GDPR export\?/i,
    })
    expect(
      view.container.querySelector('[data-import-source-card="paste-url"]'),
    ).toContainElement(linkTrigger)
    expect(
      view.container.querySelector('[data-import-source-card="file-upload"]'),
    ).toContainElement(gdprTrigger)
    expect(screen.queryByText(/no GDPR wait/i)).not.toBeInTheDocument()

    await user.click(gdprTrigger)
    expect(
      await screen.findByText(/Dumps with several groups get a picker/i),
    ).toBeInTheDocument()
  })

  it('resolves single-group dumps straight into onLoaded', async () => {
    const user = userEvent.setup()
    const onLoaded = vi.fn()
    const onMultiLoaded = vi.fn()
    const onError = vi.fn()
    render(
      <TricountSourceTab
        onLoaded={onLoaded}
        onMultiLoaded={onMultiLoaded}
        onError={onError}
      />,
    )
    const { file, input } = upload(SINGLE_CSV)
    await user.upload(input, file)
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
    expect(onLoaded.mock.calls[0]![0].name).toBe('City trip')
    expect(onMultiLoaded).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('routes multi-group dumps through the picker into onMultiLoaded', async () => {
    const user = userEvent.setup()
    const onLoaded = vi.fn()
    const onMultiLoaded = vi.fn()
    const onError = vi.fn()
    render(
      <TricountSourceTab
        onLoaded={onLoaded}
        onMultiLoaded={onMultiLoaded}
        onError={onError}
      />,
    )
    const { file, input } = upload(MULTI_CSV)
    await user.upload(input, file)
    await waitFor(() => expect(screen.getByText('Mountain hut')).toBeTruthy())
    expect(onLoaded).not.toHaveBeenCalled()
    // Deselect the second group, continue with one → single path.
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    await user.click(boxes[1]!)
    await user.click(
      screen.getByRole('button', { name: /Continue with 1 selected/ }),
    )
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
    expect(onLoaded.mock.calls[0]![0].name).toBe('City trip')
  })

  it('rejects non-Tricount URLs before fetching', async () => {
    const user = userEvent.setup()
    const onLoaded = vi.fn()
    render(
      <TricountSourceTab
        onLoaded={onLoaded}
        onMultiLoaded={vi.fn()}
        onError={vi.fn()}
      />,
    )
    const input = screen.getByPlaceholderText('https://tricount.com/t…')
    await user.type(input, 'https://example.com/groups/abc')
    await user.click(screen.getByRole('button', { name: /Import group/i }))
    expect(
      await screen.findByText(/doesn't look like a Tricount share link/),
    ).toBeTruthy()
    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('reports unparseable files via onError', async () => {
    const user = userEvent.setup()
    const onLoaded = vi.fn()
    const onMultiLoaded = vi.fn()
    const onError = vi.fn()
    render(
      <TricountSourceTab
        onLoaded={onLoaded}
        onMultiLoaded={onMultiLoaded}
        onError={onError}
      />,
    )
    const { file, input } = upload('a,b,c\n1,2,3\n')
    await user.upload(input, file)
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onLoaded).not.toHaveBeenCalled()
    expect(onMultiLoaded).not.toHaveBeenCalled()
  })
})
