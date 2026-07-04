import { describe, expect, it } from 'vitest'

function classifyExpenseItemUpdate(
  item: { id?: string },
  existingItemIds: Set<string>,
): 'update' | 'create' {
  if (item.id && existingItemIds.has(item.id)) return 'update'
  return 'create'
}

describe('classifyExpenseItemUpdate', () => {
  it('returns "update" when item id is in existingItemIds', () => {
    const ids = new Set(['existing-1', 'existing-2'])
    expect(classifyExpenseItemUpdate({ id: 'existing-1' }, ids)).toBe('update')
  })

  it('returns "create" when item has no id', () => {
    expect(classifyExpenseItemUpdate({ id: undefined }, new Set())).toBe(
      'create',
    )
  })

  it('returns "create" when item id is not in existingItemIds (client-generated)', () => {
    expect(
      classifyExpenseItemUpdate(
        { id: 'new-client-uuid' },
        new Set(['existing-1']),
      ),
    ).toBe('create')
  })

  it('returns "create" when item id is empty string', () => {
    expect(classifyExpenseItemUpdate({ id: '' }, new Set())).toBe('create')
  })
})
