import { describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { selectAnnouncementRecipients } from './campaigns'

const announcement = {
  id: 'spliit-cloud-2-5-0',
  date: '2026-10-05',
  title: 'Spliit Cloud 2.5.0 is here',
  channels: ['updates', 'modal', 'email'],
} as const

describe('selectAnnouncementRecipients', () => {
  it('bounds recipients by both campaign creation and the publication day', async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never)
    const createdBefore = new Date('2026-10-19T00:00:00.000Z')
    await selectAnnouncementRecipients(announcement, {
      afterId: null,
      limit: 500,
      createdBefore,
    })
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        emailVerified: true,
        createdAt: {
          lt: new Date('2026-10-05T00:00:00.000Z'),
          lte: createdBefore,
        },
        email: { not: { endsWith: '.placeholder.local' } },
      },
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true },
    })
  })

  it('keeps the cursor keyset when paging', async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never)
    await selectAnnouncementRecipients(announcement, {
      afterId: 'acc-9',
      limit: 500,
      createdBefore: new Date('2026-10-19T00:00:00.000Z'),
    })
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 'acc-9' } }),
      }),
    )
  })
})
