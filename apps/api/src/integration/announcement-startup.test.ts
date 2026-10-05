import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { prisma } from '@spliit/db'

const startup = vi.hoisted(() => ({
  enabled: true,
  announcements: [] as Array<{
    id: string
    date: string
    title: string
    inApp: boolean
    email: boolean
  }>,
}))

vi.mock('@spliit/domain/announcements', () => ({
  announcements: startup.announcements,
}))
vi.mock('../lib/env', () => ({
  env: {
    get CLOUD_NEWS_ENABLED() {
      return startup.enabled
    },
  },
}))

const ids = [
  'announcement-startup-test-first',
  'announcement-startup-test-second',
  'announcement-startup-test-disabled',
]
const accountId = 'announcement-startup-test-account'

beforeAll(async () => {
  await prisma.announcementCampaign.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: accountId } })
})
afterAll(async () => {
  await prisma.announcementCampaign.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: accountId } })
  await prisma.$disconnect()
})

it('registers each new Cloud campaign once across API starts', async () => {
  startup.announcements.push({
    id: ids[0]!,
    date: '2026-09-25',
    title: 'First',
    inApp: true,
    email: true,
  })
  const { activateAnnouncementCampaigns } =
    await import('../lib/announcements/activate')
  await activateAnnouncementCampaigns()
  await prisma.user.create({
    data: {
      id: accountId,
      name: 'Announcement startup test',
      email: 'announcement-startup-test@example.invalid',
    },
  })
  await prisma.announcementEmailDelivery.create({
    data: {
      id: 'announcement-startup-test-delivery',
      campaignId: ids[0]!,
      accountId,
      status: 'SENT',
    },
  })
  await activateAnnouncementCampaigns()
  expect(
    await prisma.announcementCampaign.count({ where: { id: ids[0] } }),
  ).toBe(1)
  expect(
    await prisma.announcementEmailDelivery.findMany({
      where: { campaignId: ids[0] },
      select: { status: true },
    }),
  ).toEqual([{ status: 'SENT' }])

  startup.announcements.push({
    id: ids[1]!,
    date: '2026-09-26',
    title: 'Second',
    inApp: true,
    email: true,
  })
  vi.resetModules()
  const updated = await import('../lib/announcements/activate')
  await updated.activateAnnouncementCampaigns()
  expect(
    await prisma.announcementCampaign.count({ where: { id: { in: ids } } }),
  ).toBe(2)

  startup.enabled = false
  startup.announcements.push({
    id: ids[2]!,
    date: '2026-09-27',
    title: 'Disabled',
    inApp: true,
    email: true,
  })
  await updated.activateAnnouncementCampaigns()
  expect(
    await prisma.announcementCampaign.count({ where: { id: ids[2] } }),
  ).toBe(0)
})
