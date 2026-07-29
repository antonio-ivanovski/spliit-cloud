import { describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { buildGroupActivityData, logActivity } from './activities'

describe('logActivity', () => {
  it('skips the group lookup when a ledger id is supplied', async () => {
    prismaMock.activity.create.mockResolvedValue({ id: 'activity-1' } as never)

    await logActivity(
      'group-1',
      {
        type: 'GROUP_UPDATED',
        subject: { type: 'GROUP', id: 'group-1' },
        data: buildGroupActivityData({ summary: 'Group updated' }),
      },
      prismaMock,
      'ledger-known',
    )

    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ledgerId: 'ledger-known' }),
    })
  })
})
