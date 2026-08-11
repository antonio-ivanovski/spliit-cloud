import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  toggleCategorySelection,
} from '@spliit/domain'

import { CategorySelector } from './category-selector'

describe('CategorySelector', () => {
  it('shows selectable parent rows in multi mode and stores the parent id', async () => {
    const user = userEvent.setup()
    const onValueToggle = vi.fn()

    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        mode="multi"
        onValueChange={() => {}}
        onValueToggle={onValueToggle}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    const parent = await screen.findByRole('option', {
      name: /^Home$/,
    })
    expect(parent).toHaveClass('font-semibold')
    expect(screen.getByText('Rent').parentElement).toHaveClass('ps-8')

    await user.click(parent)
    expect(onValueToggle).toHaveBeenCalledWith('home')
  })

  it('marks all children checked when the parent is selected', async () => {
    const user = userEvent.setup()

    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        mode="multi"
        onValueChange={() => {}}
        selectedValues={['home']}
        onValueToggle={() => {}}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    const parent = await screen.findByRole('option', {
      name: /^Home$/,
    })
    // Parent row and child rows all show a visible check icon.
    expect(parent.querySelector('svg.lucide-check')).toBeTruthy()
    const rent = screen.getByText('Rent').closest('[role="option"]')
    expect(rent?.querySelector('svg.lucide-check')).toBeTruthy()
  })

  it('selects a parent or child in single mode', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        onValueChange={onValueChange}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: /^Home$/ })).toBeInTheDocument()

    await user.click(await screen.findByText('Rent'))
    expect(onValueChange).toHaveBeenCalledWith('rent')
  })

  it('collapses all children to the parent via toggleCategorySelection', () => {
    const homeChildren = DEFAULT_CATEGORIES.filter(
      (category) => category.parentId === 'home',
    ).map((category) => category.id)
    // Toggling a child that is already selected (while all are selected except
    // one) expands to the other children.
    expect(
      toggleCategorySelection(
        homeChildren.filter((id) => id !== 'rent'),
        'rent',
      ),
    ).toEqual(['home'])
    // Selecting the missing sibling collapses.
    expect(
      toggleCategorySelection(
        homeChildren.filter((id) => id !== 'rent'),
        'rent',
      ),
    ).toEqual(['home'])
  })
})
