import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { DoneStep } from './done-step'

describe('DoneStep', () => {
  it('promotes the account batch summary into the success hero', () => {
    render(
      <DoneStep
        groupId={null}
        invites={[]}
        onContinue={vi.fn()}
        continueLabel="Back to home"
        batchSummary={{
          completed: [{ sourceId: 'group-1', name: 'Summer trip' }],
          skipped: [{ sourceId: 'group-2', name: 'Old ledger' }],
        }}
      />,
    )

    expect(screen.getAllByText('Import complete')).toHaveLength(1)
    expect(
      screen.getByText('Import Spliit Cloud account backup'),
    ).toBeInTheDocument()
    expect(screen.getByText('Summer trip')).toBeInTheDocument()
    expect(screen.getByText('Old ledger')).toHaveClass('line-through')
    expect(
      screen.getByRole('button', { name: 'Back to home' }),
    ).toBeInTheDocument()
  })
})
