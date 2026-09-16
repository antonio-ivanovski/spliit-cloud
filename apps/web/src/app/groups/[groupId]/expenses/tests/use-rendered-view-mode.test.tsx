import { render, screen } from '@/test/test-utils'

import { useRenderedViewMode } from '../use-rendered-view-mode'

function Probe({
  showAll,
  placeholder,
}: {
  showAll: boolean
  placeholder: boolean
}) {
  const rendered = useRenderedViewMode(showAll, placeholder)
  return <div data-testid="rendered">{rendered ? 'all' : 'for-you'}</div>
}

function renderedMode(): string {
  const el = screen.getByTestId('rendered')
  if (!el.textContent) throw new Error('expected a rendered mode')
  return el.textContent
}

describe('useRenderedViewMode', () => {
  it('passes the live mode through when rows are fresh', () => {
    const view = render(<Probe showAll={false} placeholder={false} />)
    expect(renderedMode()).toBe('for-you')
    view.rerender(<Probe showAll={true} placeholder={false} />)
    expect(renderedMode()).toBe('all')
  })

  it('freezes the previous mode while placeholder rows load, then flips', () => {
    const view = render(<Probe showAll={false} placeholder={false} />)
    expect(renderedMode()).toBe('for-you')

    // Mode switch starts a refetch: stale rows stay under the old mode.
    view.rerender(<Probe showAll={true} placeholder={true} />)
    expect(renderedMode()).toBe('for-you')

    // Fresh rows arrive: both flip together in one clean swap.
    view.rerender(<Probe showAll={true} placeholder={false} />)
    expect(renderedMode()).toBe('all')
  })

  it('freezes symmetrically when switching back to For you', () => {
    const view = render(<Probe showAll={true} placeholder={false} />)
    expect(renderedMode()).toBe('all')

    view.rerender(<Probe showAll={false} placeholder={true} />)
    expect(renderedMode()).toBe('all')

    view.rerender(<Probe showAll={false} placeholder={false} />)
    expect(renderedMode()).toBe('for-you')
  })
})
