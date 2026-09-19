import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebhookDeliveryStatus } from '@spliit/domain/webhooks'
import { JOB_NAMES } from '@spliit/jobs'

import '../../../test/mocks'
import { usePrismaMemoryStore } from '../../../test/prisma-memory-store'
import { prismaMock } from '../../../test/state'
import { webhooksRouter } from './index'

const jobMocks = vi.hoisted(() => ({
  getApiBoss: vi.fn(),
  insertJobs: vi.fn(),
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return { ...jobs, insertJobs: jobMocks.insertJobs }
})

vi.mock('../../../lib/api/boss', () => ({
  getApiBoss: jobMocks.getApiBoss,
}))

function makeCaller(authUserId = 'acct-self') {
  return webhooksRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

const NOW = new Date('2026-01-01T00:00:00.000Z')
const HOOK_URL = 'https://example.com/hook'

function seed(args: {
  endpointEnabled?: boolean
  endpointAccountId?: string
  deliveryStatus?: string
  deliveryOverrides?: Record<string, unknown>
  extraDeliveries?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
}) {
  const endpointEnabled = args.endpointEnabled ?? true
  const accountId = args.endpointAccountId ?? 'acct-self'
  const deliveryOverrides = args.deliveryOverrides ?? {}
  usePrismaMemoryStore({
    user: [{ id: accountId, isAnonymous: false, emailVerified: true }],
    webhookEndpoint: [
      {
        id: 'ep-1',
        accountId,
        name: 'Hook',
        url: HOOK_URL,
        enabled: endpointEnabled,
        notifyCreated: true,
        notifyUpdated: true,
        notifyDeleted: true,
        secretVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    webhookEvent: args.events ?? [
      {
        id: 'evt-1',
        sourceKey: 'test:evt-1',
        type: 'expense.created',
        apiVersion: 'v1',
        occurredAt: NOW,
        payload: {},
        groupId: null,
        activityId: null,
        allowAfterDelete: false,
        createdAt: NOW,
      },
    ],
    webhookDelivery: [
      {
        id: 'del-1',
        endpointId: 'ep-1',
        eventId: 'evt-1',
        status: args.deliveryStatus ?? WebhookDeliveryStatus.SENT,
        attemptCount: 1,
        createdAt: NOW,
        updatedAt: NOW,
        ...deliveryOverrides,
      },
      ...(args.extraDeliveries ?? []),
    ],
  })
}

beforeEach(() => {
  jobMocks.getApiBoss.mockReset()
  jobMocks.insertJobs.mockReset()
  jobMocks.getApiBoss.mockResolvedValue({} as never)
  jobMocks.insertJobs.mockResolvedValue(undefined as never)
})

describe('webhooksRouter.redeliver', () => {
  it('re-queues a failed delivery on an enabled endpoint and clears stale fields', async () => {
    seed({
      deliveryStatus: WebhookDeliveryStatus.PERMANENT_FAILURE,
      deliveryOverrides: {
        lastAttemptAt: NOW,
        lastHttpStatus: 500,
        lastErrorCode: 'HTTP_500',
        lastErrorMessage: 'boom',
        terminalAt: NOW,
      },
    })

    await makeCaller().redeliver({ deliveryId: 'del-1' })

    const delivery = await prismaMock.webhookDelivery.findUnique({
      where: { id: 'del-1' },
    })
    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      lastAttemptAt: null,
      lastHttpStatus: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      sentAt: null,
      terminalAt: null,
    })
    expect(jobMocks.insertJobs).toHaveBeenCalledTimes(1)
    expect(jobMocks.insertJobs).toHaveBeenCalledWith(
      expect.anything(),
      JOB_NAMES.WEBHOOK_DELIVER,
      [{ deliveryId: 'del-1' }],
      expect.objectContaining({}),
    )
  })

  it('refuses redelivery while the endpoint is disabled', async () => {
    seed({
      endpointEnabled: false,
      deliveryStatus: WebhookDeliveryStatus.PERMANENT_FAILURE,
    })

    await expect(
      makeCaller().redeliver({ deliveryId: 'del-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(jobMocks.insertJobs).not.toHaveBeenCalled()
    const delivery = await prismaMock.webhookDelivery.findUnique({
      where: { id: 'del-1' },
    })
    expect(delivery?.status).toBe(WebhookDeliveryStatus.PERMANENT_FAILURE)
  })

  it('allows resending a canceled delivery once the endpoint is re-enabled', async () => {
    seed({
      endpointEnabled: false,
      deliveryStatus: WebhookDeliveryStatus.CANCELED,
    })
    const caller = makeCaller()

    await caller.update({
      endpointId: 'ep-1',
      name: 'Hook',
      url: HOOK_URL,
      enabled: true,
      events: {
        created: true,
        updated: true,
        deleted: true,
        involvedOnly: false,
      },
    })
    await caller.redeliver({ deliveryId: 'del-1' })

    const delivery = await prismaMock.webhookDelivery.findUnique({
      where: { id: 'del-1' },
    })
    expect(delivery?.status).toBe(WebhookDeliveryStatus.PENDING)
    expect(jobMocks.insertJobs).toHaveBeenCalledTimes(1)
  })

  it.each([WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.PROCESSING])(
    'rejects redelivery of an in-flight (%s) delivery without enqueueing',
    async (status) => {
      seed({ deliveryStatus: status })

      await expect(
        makeCaller().redeliver({ deliveryId: 'del-1' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(jobMocks.insertJobs).not.toHaveBeenCalled()
      const delivery = await prismaMock.webhookDelivery.findUnique({
        where: { id: 'del-1' },
      })
      expect(delivery?.status).toBe(status)
    },
  )

  it('rejects deliveries owned by another account', async () => {
    seed({
      endpointAccountId: 'acct-other',
      deliveryStatus: WebhookDeliveryStatus.PERMANENT_FAILURE,
    })

    await expect(
      makeCaller('acct-self').redeliver({ deliveryId: 'del-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(jobMocks.insertJobs).not.toHaveBeenCalled()
  })
})

describe('webhooksRouter.update cancellations', () => {
  const updateInput = {
    endpointId: 'ep-1',
    name: 'Hook',
    url: HOOK_URL,
    enabled: true,
    events: {
      created: true,
      updated: true,
      deleted: true,
      involvedOnly: false,
    },
  }

  it('force-disables the endpoint and cancels pending work on URL change', async () => {
    seed({ deliveryStatus: WebhookDeliveryStatus.PENDING })

    const updated = await makeCaller().update({
      ...updateInput,
      url: 'https://example.com/hook-2',
    })

    expect(updated.enabled).toBe(false)
    const delivery = await prismaMock.webhookDelivery.findUnique({
      where: { id: 'del-1' },
    })
    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'ENDPOINT_URL_CHANGED',
    })
  })

  it('cancels pending work when disabling without a URL change', async () => {
    seed({ deliveryStatus: WebhookDeliveryStatus.PROCESSING })

    await makeCaller().update({ ...updateInput, enabled: false })

    const delivery = await prismaMock.webhookDelivery.findUnique({
      where: { id: 'del-1' },
    })
    expect(delivery).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'ENDPOINT_DISABLED',
    })
  })

  it('persists the involved-only flag on update', async () => {
    seed({})

    const updated = await makeCaller().update({
      ...updateInput,
      events: {
        created: true,
        updated: true,
        deleted: true,
        involvedOnly: true,
      },
    })

    expect(updated.involvedOnly).toBe(true)
  })

  it('cancels only the unsubscribed types when event filters change', async () => {
    seed({
      deliveryStatus: WebhookDeliveryStatus.PENDING,
      events: [
        {
          id: 'evt-1',
          sourceKey: 'test:evt-1',
          type: 'expense.created',
          apiVersion: 'v1',
          occurredAt: NOW,
          payload: {},
          groupId: null,
          activityId: null,
          allowAfterDelete: false,
          createdAt: NOW,
        },
        {
          id: 'evt-2',
          sourceKey: 'test:evt-2',
          type: 'expense.updated',
          apiVersion: 'v1',
          occurredAt: NOW,
          payload: {},
          groupId: null,
          activityId: null,
          allowAfterDelete: false,
          createdAt: NOW,
        },
      ],
      extraDeliveries: [
        {
          id: 'del-2',
          endpointId: 'ep-1',
          eventId: 'evt-2',
          status: WebhookDeliveryStatus.PENDING,
          attemptCount: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    })

    await makeCaller().update({
      ...updateInput,
      events: {
        created: true,
        updated: false,
        deleted: true,
        involvedOnly: false,
      },
    })

    // del-1 (expense.created) survives; del-2 (expense.updated) is canceled.
    expect(
      await prismaMock.webhookDelivery.findUnique({ where: { id: 'del-1' } }),
    ).toMatchObject({ status: WebhookDeliveryStatus.PENDING })
    expect(
      await prismaMock.webhookDelivery.findUnique({ where: { id: 'del-2' } }),
    ).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'ENDPOINT_FILTER_CHANGED',
    })
  })

  it('leaves pending work alone when filters are unchanged', async () => {
    seed({ deliveryStatus: WebhookDeliveryStatus.PENDING })

    await makeCaller().update({ ...updateInput, name: 'Renamed' })

    expect(
      await prismaMock.webhookDelivery.findUnique({ where: { id: 'del-1' } }),
    ).toMatchObject({ status: WebhookDeliveryStatus.PENDING })
  })
})

describe('webhooksRouter remaining guards', () => {
  it('rotates the secret to a new whsec_ value', async () => {
    seed({})
    const caller = makeCaller()

    const first = await caller.rotateSecret({ endpointId: 'ep-1' })
    const second = await caller.rotateSecret({ endpointId: 'ep-1' })

    expect(first.secret).toMatch(/^whsec_/)
    expect(second.secret).toMatch(/^whsec_/)
    expect(second.secret).not.toBe(first.secret)
  })

  it('sends a test event even for a disabled endpoint', async () => {
    seed({ endpointEnabled: false })
    const caller = makeCaller()

    const { deliveryId } = await caller.test({ endpointId: 'ep-1' })

    expect(typeof deliveryId).toBe('string')
    expect(jobMocks.insertJobs).toHaveBeenCalledTimes(1)
    const delivery = await prismaMock.webhookDelivery.findUnique({
      where: { id: deliveryId },
    })
    expect(delivery?.endpointId).toBe('ep-1')
  })

  it('paginates deliveries and scopes detail reads to the owner', async () => {
    const events = [1, 2, 3].map((n) => ({
      id: `evt-${n}`,
      sourceKey: `test:evt-${n}`,
      type: 'expense.created',
      apiVersion: 'v1',
      occurredAt: new Date(`2026-01-0${n}T00:00:00.000Z`),
      payload: {},
      groupId: null,
      activityId: null,
      allowAfterDelete: false,
      createdAt: new Date(`2026-01-0${n}T00:00:00.000Z`),
    }))
    seed({
      deliveryStatus: WebhookDeliveryStatus.SENT,
      events,
      extraDeliveries: [2, 3].map((n) => ({
        id: `del-${n}`,
        endpointId: 'ep-1',
        eventId: `evt-${n}`,
        status: WebhookDeliveryStatus.SENT,
        attemptCount: 1,
        createdAt: new Date(`2026-01-0${n}T00:00:00.000Z`),
        updatedAt: new Date(`2026-01-0${n}T00:00:00.000Z`),
      })),
    })
    // del-1 points at evt-1 already via the base seed.
    const caller = makeCaller()

    const page1 = await caller.deliveries({ endpointId: 'ep-1', limit: 2 })
    expect(page1.deliveries.map(({ id }) => id)).toEqual(['del-3', 'del-2'])
    expect(page1.nextCursor).toBe('del-2')

    const page2 = await caller.deliveries({
      endpointId: 'ep-1',
      limit: 2,
      cursor: page1.nextCursor,
    })
    expect(page2.deliveries.map(({ id }) => id)).toEqual(['del-1'])
    expect(page2.nextCursor).toBeNull()

    await expect(
      makeCaller('acct-other').delivery({ deliveryId: 'del-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('no longer exposes a setEnabled procedure', () => {
    expect(webhooksRouter._def.procedures).not.toHaveProperty('setEnabled')
  })
})
