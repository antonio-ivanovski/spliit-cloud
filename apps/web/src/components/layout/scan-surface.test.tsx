import { describe, expect, it } from 'vitest'

import {
  ScanStickyHeading,
  ScanSurface,
} from '@/components/layout/scan-surface'
import { render, screen } from '@/test/test-utils'

describe('ScanSurface', () => {
  it('escapes the mobile rail and restores a card at the desktop breakpoint', () => {
    render(<ScanSurface aria-label="Expense feed">Feed</ScanSurface>)

    const surface = screen.getByRole('region', { name: 'Expense feed' })
    expect(surface).toHaveAttribute('data-scan-surface')
    expect(surface).toHaveClass('-mx-1', 'sm:mx-0')
    expect(surface).not.toHaveClass('rounded-lg', 'border', 'bg-card')
    expect(surface).toHaveClass(
      'sm:rounded-lg',
      'sm:border',
      'sm:bg-card',
      'sm:shadow-xs',
    )
  })

  it('uses the page canvas on mobile and the card canvas on desktop', () => {
    render(<ScanStickyHeading>Today</ScanStickyHeading>)

    expect(screen.getByText('Today')).toHaveClass(
      'bg-background',
      'px-4',
      'sm:bg-card',
      'sm:px-6',
    )
  })
})
