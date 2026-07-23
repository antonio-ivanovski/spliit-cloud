import { RecurringBadge } from '@/app/groups/[groupId]/expenses/series-controls'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'

describe('RecurringBadge', () => {
  it('renders the Running label for an ACTIVE series', () => {
    render(<RecurringBadge status="ACTIVE" />)
    expect(screen.getByText('Recurring · Running')).toBeInTheDocument()
  })

  it('renders the Running label for a PAUSED series', () => {
    render(<RecurringBadge status="PAUSED" />)
    expect(screen.getByText('Recurring · Running')).toBeInTheDocument()
  })

  it('renders the Stopped label for a CANCELLED series', () => {
    render(<RecurringBadge status="CANCELLED" />)
    expect(screen.getByText('Recurring · Stopped')).toBeInTheDocument()
  })

  it('renders the Completed label for a COMPLETED series', () => {
    render(<RecurringBadge status="COMPLETED" />)
    expect(screen.getByText('Recurring · Completed')).toBeInTheDocument()
  })

  it('defaults to the Running label when status is undefined', () => {
    render(<RecurringBadge />)
    expect(screen.getByText('Recurring · Running')).toBeInTheDocument()
  })
})
