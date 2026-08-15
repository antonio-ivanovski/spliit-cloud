import { describe, expect, it, vi } from 'vitest'

import { OfflineEmptyState } from '@/components/offline-empty-state'
import { render, screen } from '@/test/test-utils'

describe('OfflineEmptyState', () => {
  it('renders the offline empty copy', () => {
    render(<OfflineEmptyState />)
    const state = screen.getByTestId('offline-empty-state')
    expect(state).toHaveTextContent(/offline/i)
    expect(state).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('calls onRetry when the retry button is pressed', async () => {
    const onRetry = vi.fn()
    const { user } = render(<OfflineEmptyState onRetry={onRetry} />)
    await user.click(screen.getByRole('button'))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders a custom description and coming-soon detail', () => {
    render(
      <OfflineEmptyState
        description="Currency conversion needs a connection."
        detail="Full offline support is coming soon."
      />,
    )
    const state = screen.getByTestId('offline-empty-state')
    expect(state).toHaveTextContent('Currency conversion needs a connection.')
    expect(state).toHaveTextContent('Full offline support is coming soon.')
  })
})
