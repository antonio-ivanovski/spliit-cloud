import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import type * as announcementsModule from '@spliit/domain/announcements'
import type { announcements as registryType } from '@spliit/domain/announcements'

import { prismaMock } from '../../test/state'

type RegistryEntry = (typeof registryType)[number]

const registry = vi.hoisted(() => ({
  announcements: [] as Array<{
    id: string
    date: string
    title: string
    channels: RegistryEntry['channels']
  }>,
}))

vi.mock('@spliit/domain/announcements', async (importOriginal) => {
  const actual = await (
    importOriginal as () => Promise<typeof announcementsModule>
  )()
  // The real helpers close over the real registry binding, so re-point the
  // registry reads at the test array. `hasAnnouncementChannel` is pure and
  // stays real.
  const find = (id: string) =>
    registry.announcements.find((entry) => entry.id === id) as never
  return {
    ...actual,
    get announcements() {
      return registry.announcements
    },
    getAnnouncement: find,
    getAnnouncementContent: (id: string) => find(id),
    latestModalAnnouncement: () =>
      [...registry.announcements]
        .reverse()
        .find((entry) => entry.channels.includes('modal')) as never,
  }
})

// Import after the mock so the router binds the mocked registry.
const { announcementsRouter } = await import('./announcements')

function caller(
  accountId = 'account-1',
  createdAt: Date = new Date('2026-09-15T00:00:00.000Z'),
) {
  return announcementsRouter.createCaller({
    auth: {
      user: { id: accountId, createdAt },
      session: { id: 'sess-1' },
    },
  } as never)
}

beforeEach(() => {
  registry.announcements.length = 0
  registry.announcements.push(
    {
      id: 'loud-entry',
      date: '2026-10-01',
      title: 'Loud',
      channels: ['updates', 'modal', 'email'],
    },
    {
      id: 'quiet-entry',
      date: '2026-10-02',
      title: 'Quiet',
      channels: ['updates'],
    },
  )
})

describe('announcementsRouter channels', () => {
  it('lists updates-channel entries including quiet ones', async () => {
    const result = await caller().list()
    expect(result).toEqual([
      { id: 'loud-entry', date: '2026-10-01' },
      { id: 'quiet-entry', date: '2026-10-02' },
    ])
  })

  it('latestStatus falls back to the newest modal entry past a quiet latest', async () => {
    prismaMock.announcementView.findUnique.mockResolvedValue(null as never)
    const result = await caller().latestStatus()
    expect(result).toEqual({ announcementId: 'loud-entry', viewed: false })
  })

  it('latestStatus reports the modal entry viewed once marked', async () => {
    prismaMock.announcementView.findUnique.mockResolvedValue({
      viewedAt: new Date(),
    } as never)
    const result = await caller().latestStatus()
    expect(result).toEqual({ announcementId: 'loud-entry', viewed: true })
  })

  it('latestStatus hides the modal from accounts registered on the publication day', async () => {
    const result = await caller(
      'account-1',
      new Date('2026-10-01T00:00:00.000Z'),
    ).latestStatus()
    expect(result).toEqual({ announcementId: null, viewed: true })
    expect(prismaMock.announcementView.findUnique).not.toHaveBeenCalled()
  })

  it('latestStatus serves the modal to accounts registered before the publication day', async () => {
    prismaMock.announcementView.findUnique.mockResolvedValue(null as never)
    const result = await caller(
      'account-1',
      new Date('2026-09-30T23:59:59.999Z'),
    ).latestStatus()
    expect(result).toEqual({ announcementId: 'loud-entry', viewed: false })
  })

  it('latestStatus judges account age against the modal entry, not a newer quiet one', async () => {
    // The quiet entry is dated 2026-10-02 while the modal entry is 2026-10-01:
    // an account registered after the modal's publication day gets nothing.
    const result = await caller(
      'account-1',
      new Date('2026-10-02T00:00:00.000Z'),
    ).latestStatus()
    expect(result).toEqual({ announcementId: null, viewed: true })
  })

  it('markViewed accepts quiet entries', async () => {
    prismaMock.announcementView.upsert.mockResolvedValue({} as never)
    await expect(
      caller().markViewed({ announcementId: 'quiet-entry' }),
    ).resolves.toEqual({ viewed: true })
    expect(prismaMock.announcementView.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_announcementId: {
            accountId: 'account-1',
            announcementId: 'quiet-entry',
          },
        },
      }),
    )
  })

  it('markViewed rejects unknown entries', async () => {
    await expect(
      caller().markViewed({ announcementId: 'no-such-entry' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
