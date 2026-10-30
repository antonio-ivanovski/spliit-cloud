import { describe, expect, it, vi } from 'vitest'

import { PersonalQuickAdd } from '@/app/personal/quick-add'
import { zonedDateOnlyIso } from '@/lib/utils'
import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('@/app/personal/api', () => ({
  usePersonalProfile: () => ({
    data: { currencyCode: 'USD', timeZone: 'UTC', sharedEnabled: false },
    isPending: false,
    isError: false,
  }),
  useCreatePersonalTransaction: () => ({
    mutateAsync: mocks.mockCreate,
    isPending: false,
  }),
  useSuggestPersonalCategory: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      categoryId: null,
      candidates: [],
    }),
    isPending: false,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

function openQuickAdd() {
  return render(
    <PersonalQuickAdd open onOpenChange={vi.fn()} defaultKind="EXPENSE" />,
  )
}

describe('PersonalQuickAdd', () => {
  it('blocks submit with a validation message when the amount is missing', async () => {
    mocks.mockCreate.mockReset()
    const { user } = openQuickAdd()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      screen.getByText('Enter an amount greater than zero.'),
    ).toBeInTheDocument()
    expect(mocks.mockCreate).not.toHaveBeenCalled()
  })

  it('submits an expense in minor units with the chosen category and date', async () => {
    mocks.mockCreate.mockReset().mockResolvedValue({ id: 'new-id' })
    const { user } = openQuickAdd()

    await user.type(screen.getByLabelText('Amount'), '42.50')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.mockCreate).toHaveBeenCalledTimes(1)
    const input = mocks.mockCreate.mock.calls[0]![0] as {
      requestId: string
      entry: Record<string, unknown>
    }
    expect(typeof input.requestId).toBe('string')
    expect(input.entry).toMatchObject({
      kind: 'EXPENSE',
      amount: 4250,
      currencyCode: 'USD',
      date: zonedDateOnlyIso(new Date(), 'UTC'),
      categoryId: 'general',
    })
  })

  it('submits income when the income toggle is active', async () => {
    mocks.mockCreate.mockReset().mockResolvedValue({ id: 'new-id' })
    const { user } = openQuickAdd()

    await user.click(screen.getByRole('button', { name: 'Income' }))
    await user.type(screen.getByLabelText('Amount'), '100')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.mockCreate).toHaveBeenCalledTimes(1)
    const input = mocks.mockCreate.mock.calls[0]![0] as {
      entry: Record<string, unknown>
    }
    expect(input.entry).toMatchObject({ kind: 'INCOME', amount: 10000 })
  })
})
