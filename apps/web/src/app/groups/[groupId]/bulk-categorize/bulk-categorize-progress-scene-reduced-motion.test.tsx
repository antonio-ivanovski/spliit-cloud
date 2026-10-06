import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
}))

import { BulkCategorizeProgressScene } from './bulk-categorize-progress-scene'

describe('BulkCategorizeProgressScene with reduced motion', () => {
  it('shows Bill in a still sorting pose without starting a receipt journey', () => {
    const animate = vi.fn()
    const originalAnimate = HTMLElement.prototype.animate
    HTMLElement.prototype.animate = animate
    try {
      render(<BulkCategorizeProgressScene />)
      const scene = screen.getByTestId('bill-sort-scene')
      expect(
        scene.querySelector('[data-mascot-sorting-face="reading"]'),
      ).toBeInTheDocument()
      expect(
        scene.querySelector('.bill-sort-scene__incoming'),
      ).toBeInTheDocument()
      expect(scene.querySelectorAll('.bill-sort-scene__tray')).toHaveLength(5)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(scene.querySelector('.bill-sort-scene__idea')).toBeInTheDocument()
      expect(
        scene.querySelectorAll(
          '.bill-sort-scene__stack-sheet .bill-sort-scene__receipt-heading',
        ),
      ).toHaveLength(6)
      expect(
        scene.querySelectorAll('.bill-sort-scene__stack-sheet--hidden'),
      ).toHaveLength(2)
      expect(animate).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.animate = originalAnimate
    }
  })
})
