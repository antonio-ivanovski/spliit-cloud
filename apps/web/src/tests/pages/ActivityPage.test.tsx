import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

vi.mock('@/app/groups/[groupId]/activity/activity-list', () => ({
  ActivityList: () => <div data-testid="activity-list" />,
}))

import { ActivityPageClient } from '@/app/groups/[groupId]/activity/page.client'

describe('ActivityPageClient', () => {
  it('uses a continuous mobile scan surface with desktop card restoration', () => {
    render(<ActivityPageClient />)
    const surface = screen
      .getByTestId('activity-list')
      .closest('[data-scan-surface]')

    expect(surface).toBeInTheDocument()
    expect(surface).toHaveClass('mb-4')
    expect(surface).toHaveClass('-mx-1', 'sm:mx-0')
    expect(surface).not.toHaveClass('rounded-lg', 'border', 'bg-card')
    expect(surface).toHaveClass(
      'sm:rounded-lg',
      'sm:border',
      'sm:bg-card',
      'sm:shadow-xs',
    )
    expect(surface?.querySelector('[class~="sm:p-0"]')).toBeInTheDocument()
    expect(screen.getByTestId('activity-list')).toBeInTheDocument()
  })
})
