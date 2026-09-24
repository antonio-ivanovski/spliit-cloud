import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

vi.mock('@/components/mascot/characters/bill/bill-character', () => ({
  BillCharacter: () => {
    throw new Error('Illustration failure')
  },
}))

import { BulkCategorizeProgressScene } from './bulk-categorize-progress-scene'

describe('BulkCategorizeProgressScene error boundary', () => {
  it('keeps surrounding status visible when the illustration cannot render', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <>
          <span>Processing expenses</span>
          <BulkCategorizeProgressScene />
        </>,
      )
      expect(screen.getByText('Processing expenses')).toBeInTheDocument()
      expect(screen.queryByTestId('bill-sort-scene')).not.toBeInTheDocument()
    } finally {
      report.mockRestore()
    }
  })
})
