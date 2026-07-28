import { describe, expect, it, vi } from 'vitest'

import { ScopePickerDialog } from '@/app/groups/scope-picker-dialog'
import { render, screen } from '@/test/test-utils'

describe('ScopePickerDialog', () => {
  it('renders the title and description when open', () => {
    render(
      <ScopePickerDialog
        open={true}
        onOpenChange={() => {}}
        items={[]}
        title="Pick a group"
        description="Choose which group to use"
        emptyLabel="No groups"
      />,
    )
    expect(screen.getByText('Pick a group')).toBeInTheDocument()
    expect(screen.getByText('Choose which group to use')).toBeInTheDocument()
  })

  it('renders the empty label when no items are provided', () => {
    render(
      <ScopePickerDialog
        open={true}
        onOpenChange={() => {}}
        items={[]}
        title="Pick a group"
        emptyLabel="No groups available"
      />,
    )
    expect(screen.getByText('No groups available')).toBeInTheDocument()
  })

  it('renders each item with its display name, meta and badge', () => {
    const onClick = vi.fn()
    render(
      <ScopePickerDialog
        open={true}
        onOpenChange={() => {}}
        items={[
          {
            id: 'a',
            displayName: 'Trip A',
            meta: '3 expenses',
            badge: 'starred',
            onClick,
          },
          { id: 'b', displayName: 'Trip B', onClick },
        ]}
        title="Pick a group"
        emptyLabel="No groups"
      />,
    )
    expect(screen.getByText('Trip A')).toBeInTheDocument()
    expect(screen.getByText('3 expenses')).toBeInTheDocument()
    expect(screen.getByText('starred')).toBeInTheDocument()
    expect(screen.getByText('Trip B')).toBeInTheDocument()
  })

  it('calls onClick and onOpenChange(false) when an item is clicked', async () => {
    const onClick = vi.fn()
    const onOpenChange = vi.fn()
    const { user } = render(
      <ScopePickerDialog
        open={true}
        onOpenChange={onOpenChange}
        items={[{ id: 'a', displayName: 'Trip A', onClick }]}
        title="Pick a group"
        emptyLabel="No groups"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Trip A' }))
    expect(onClick).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
