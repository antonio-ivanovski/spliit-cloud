import { describe, expect, it } from 'vitest'

import { PageInset, PageShell } from '@/components/layout/page-shell'
import { Card } from '@/components/ui/card'
import { render, screen } from '@/test/test-utils'

describe('PageShell mobile card rail', () => {
  it('uses a four-pixel mobile rail and restores the desktop gutter', () => {
    render(<PageShell data-testid="shell">Card content</PageShell>)

    expect(screen.getByTestId('shell')).toHaveClass(
      'px-1',
      '[--page-inset:0.75rem]',
      'sm:px-4',
      'sm:[--page-inset:0rem]',
    )
  })

  it('gives standalone non-card content a sixteen-pixel inset', () => {
    render(<PageInset data-testid="inset">Page content</PageInset>)

    expect(screen.getByTestId('inset')).toHaveClass(
      'px-[var(--page-inset,1rem)]',
      'sm:px-0',
    )
  })

  it('inherits the shell inset without adding a rail to nested cards', () => {
    render(
      <PageShell>
        <PageInset data-testid="inset">Page content</PageInset>
        <Card data-testid="card">Card content</Card>
      </PageShell>,
    )

    expect(screen.getByTestId('inset')).toHaveClass(
      'px-[var(--page-inset,1rem)]',
    )
    expect(screen.getByTestId('card')).not.toHaveClass('mx-1', 'sm:mx-0')
  })
})
