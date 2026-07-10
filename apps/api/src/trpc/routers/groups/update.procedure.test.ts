import { describe, expect, it } from 'vitest'
import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

describe('groups.update currency guard', () => {
  it('returns a bad request when a stale settings form changes currency after an expense exists', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Test group',
      information: null,
      archived: false,
      ledgerId: 'ledger-1',
      ledger: { currency: '$', currencyCode: 'USD' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.expense.count.mockResolvedValue(1)

    const caller = groupsRouter.createCaller({
      auth: {
        session: { id: 'session-1' },
        user: { id: 'account-1' },
      },
    } as never)

    await expect(
      caller.update({
        groupId: 'group-1',
        groupFormValues: {
          name: 'Test group',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message:
        'Cannot change the group currency after expenses exist. Ledger amounts would no longer match.',
    })

    expect(prismaMock.ledger.update).not.toHaveBeenCalled()
  })
})
