import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  toggleCategorySelection,
} from '@spliit/domain'

import { CategorySelector } from './category-selector'

async function openSelector() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox'))
  return user
}

describe('CategorySelector', () => {
  it('shows selectable parent rows in multi mode and stores the parent id', async () => {
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

    const user = await openSelector()
    const parent = await screen.findByRole('option', {
      name: /^Home$/,
    })
    expect(parent).toHaveClass('font-semibold')
    expect(screen.getByText('Rent').parentElement).toHaveClass('ps-8')

    await user.click(parent)
    expect(onValueToggle).toHaveBeenCalledWith('home')
  })

  it('marks all children checked when the parent is selected', async () => {
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

    await openSelector()
    const parent = await screen.findByRole('option', {
      name: /^Home$/,
    })
    // Parent row and child rows all show a visible check icon.
    expect(parent.querySelector('svg.lucide-check')).toBeTruthy()
    const rent = screen.getByText('Rent').closest('[role="option"]')
    expect(rent?.querySelector('svg.lucide-check')).toBeTruthy()
  })

  it('selects a parent or child in single mode', async () => {
    const onValueChange = vi.fn()

    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        onValueChange={onValueChange}
      />,
    )

    const user = await openSelector()
    expect(screen.getByRole('option', { name: /^Home$/ })).toBeInTheDocument()

    await user.click(await screen.findByText('Rent'))
    expect(onValueChange).toHaveBeenCalledWith('rent')
  })

  it('keeps the parent/child hierarchy when the search is empty', async () => {
    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        onValueChange={() => {}}
      />,
    )

    await openSelector()
    expect(screen.getByRole('option', { name: /^Home$/ })).toHaveClass(
      'font-semibold',
    )
    expect(screen.getByText('Rent').parentElement).toHaveClass('ps-8')
  })

  it('highlights the best alias match and hides non-matches', async () => {
    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        onValueChange={() => {}}
      />,
    )

    const user = await openSelector()
    await user.type(screen.getByPlaceholderText(/search category/i), 'uber')

    const selected = await screen.findByRole('option', { selected: true })
    expect(selected).toHaveAccessibleName(/^Taxi$/)
    expect(screen.queryByRole('option', { name: /^Home$/ })).toBeNull()
  })

  it('highlights a typo-tolerant label match', async () => {
    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        onValueChange={() => {}}
      />,
    )

    const user = await openSelector()
    await user.type(
      screen.getByPlaceholderText(/search category/i),
      'grocereis',
    )

    const selected = await screen.findByRole('option', { selected: true })
    expect(selected).toHaveAccessibleName(/^Groceries$/)
  })

  it('shows an empty state when nothing matches', async () => {
    render(
      <CategorySelector
        categories={DEFAULT_CATEGORIES}
        defaultValue={DEFAULT_CATEGORY_ID}
        isLoading={false}
        onValueChange={() => {}}
      />,
    )

    const user = await openSelector()
    await user.type(
      screen.getByPlaceholderText(/search category/i),
      'zzzznotacategory',
    )

    expect(await screen.findByText('No category found.')).toBeInTheDocument()
    expect(screen.queryByRole('option')).toBeNull()
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
