import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock, resetPrisma, sendEmailMock } from '../../test/state'

vi.mock('../env', () => ({
  env: { CLOUD_NEWS_ENABLED: true },
  isEmailDeliveryEnabled: () => true,
}))
vi.mock('../auth/urls', () => ({ getWebBaseUrl: () => 'https://spliit.cloud' }))
vi.mock('../notifications/unsubscribe', () => ({
  buildEmailUnsubscribeMetadata: async () => ({
    url: 'https://api.spliit.cloud/email/unsubscribe?token=test',
    textFooter:
      'Unsubscribe: https://api.spliit.cloud/email/unsubscribe?token=test',
    headers: {
      'List-Unsubscribe':
        '<https://api.spliit.cloud/email/unsubscribe?token=test>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }),
}))

import { processAnnouncementCampaigns } from './process'

function setupDelivery(channels: string[] | null) {
  prismaMock.announcementCampaign.findMany.mockResolvedValue([
    {
      id: 'spliit-cloud-2-5-0',
      status: 'SENDING',
      createdAt: new Date(),
    },
  ] as never)
  prismaMock.announcementEmailDelivery.updateMany.mockResolvedValue({
    count: 1,
  } as never)
  prismaMock.announcementEmailDelivery.findMany.mockResolvedValue([
    { id: 'delivery-1' },
  ] as never)
  prismaMock.announcementEmailDelivery.findUniqueOrThrow.mockResolvedValue({
    id: 'delivery-1',
    accountId: 'account-1',
    campaignId: 'spliit-cloud-2-5-0',
    attempts: 0,
  } as never)
  prismaMock.user.findUnique.mockResolvedValue({
    email: 'alice@example.com',
    emailVerified: true,
    preference: { locale: 'fr-FR' },
    notificationPreferences: channels === null ? [] : [{ channels }],
  } as never)
  prismaMock.announcementEmailDelivery.count.mockResolvedValue(0)
}

describe('Cloud announcement delivery', () => {
  beforeEach(() => {
    resetPrisma()
    sendEmailMock.mockClear()
  })

  it('sends English copy even when an eligible account prefers French', async () => {
    setupDelivery(null)
    await processAnnouncementCampaigns()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
      to: 'alice@example.com',
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
    expect(sendEmailMock.mock.calls[0]?.[0]?.subject).toBe(
      'Spliit Cloud 2.5.0 is here',
    )
    expect(sendEmailMock.mock.calls[0]?.[0]?.html).toContain('lang="en"')
    expect(sendEmailMock.mock.calls[0]?.[0]?.html).toContain(
      'logo-with-text-email.png',
    )
    expect(sendEmailMock.mock.calls[0]?.[0]?.html).toContain('See all updates')
    expect(sendEmailMock.mock.calls[0]?.[0]?.html).toContain(
      'Unsubscribe from these email notifications',
    )
  })

  it('skips a recipient who opted out after audience selection', async () => {
    setupDelivery([])
    await processAnnouncementCampaigns()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(prismaMock.announcementEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: { status: 'SKIPPED' },
    })
  })
})
