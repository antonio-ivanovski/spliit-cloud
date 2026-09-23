import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen, within } from '@/test/test-utils'
import { DEFAULT_CATEGORIES, type CategoryId } from '@spliit/domain'

import {
  CategorySelector,
  type CategorySelectorBadge,
} from './category-selector'

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return { ...actual, useMediaQuery: () => false }
})

describe('CategorySelector confidence badges on mobile', () => {
  it('shows the selected and suggested category badges in the drawer', async () => {
    const user = userEvent.setup()
    const categoryBadges = new Map<CategoryId, CategorySelectorBadge>([
      [
        'groceries',
        {
          text: '87%',
          accessibleDescription: 'Jev confidence: 87%',
        },
      ],
    ])

    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        categoryBadges={categoryBadges}
        defaultValue="groceries"
        isLoading={false}
        onValueChange={() => {}}
      />,
    )

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('87%')
    expect(trigger).toHaveAccessibleDescription('Jev confidence: 87%')

    await user.click(trigger)
    const groceries = await screen.findByRole('option', { name: 'Groceries' })
    expect(within(groceries).getByText('87%')).toBeInTheDocument()
    expect(groceries).toHaveAccessibleDescription('Jev confidence: 87%')
  })
})
