import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { personalRouter } from '../trpc/routers/personal'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const runId = testRunId()
const ownerId = `acct-personal-att-owner-${runId}`
const otherId = `acct-personal-att-other-${runId}`

const PUBLIC_BASE =
  process.env.S3_UPLOAD_PUBLIC_URL ?? 'http://localhost:9000/spliit-local'
const permanentUrl = (accountId: string, name: string) =>
  `${PUBLIC_BASE}/documents/personal/${accountId}/${name}`

function caller(accountId: string) {
  return personalRouter.createCaller({
    auth: {
      session: { id: 'sess-personal-att' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
  } as never)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

let transactionId: string
let groupRowId: string

beforeAll(async () => {
  for (const [id, name] of [
    [ownerId, 'Att Owner'],
    [otherId, 'Att Other'],
  ]) {
    await prisma.user.create({
      data: {
        id,
        email: `${id}@test.example`,
        name,
        emailVerified: true,
      },
    })
  }
  await caller(ownerId).profile.get()

  const created = await caller(ownerId).transactions.create({
    requestId: crypto.randomUUID(),
    entry: {
      kind: 'EXPENSE',
      amount: 1_500,
      date: todayIso(),
      categoryId: 'groceries',
      title: 'Receipt dinner',
    },
  })
  transactionId = created.id

  // A GROUP-sourced snapshot: attachments must stay rejected for it.
  const groupRow = await prisma.personalTransaction.create({
    data: {
      id: `pt-att-group-${runId}`,
      accountId: ownerId,
      kind: 'EXPENSE',
      amount: 500,
      currencyCode: 'USD',
      date: new Date(`${todayIso()}T00:00:00.000Z`),
      categoryId: 'dining-out',
      title: 'Shared lunch',
      source: 'GROUP',
      sourceExpenseId: `exp-att-${runId}`,
      sourceGroupId: 'grp-att',
      sourceGroupName: 'Att group',
    },
  })
  groupRowId = groupRow.id
})

afterAll(async () => {
  await prisma.personalTransaction.deleteMany({
    where: { accountId: { in: [ownerId, otherId] } },
  })
  await prisma.user.deleteMany({
    where: { id: { in: [ownerId, otherId] } },
  })
})

describe('personal attachments — real DB', () => {
  it('adds permanent attachments and surfaces them in list/overview DTOs', async () => {
    const owner = caller(ownerId)
    const first = await owner.transactions.attachments.add({
      transactionId,
      attachment: {
        url: permanentUrl(ownerId, 'r1.jpg'),
        fileName: 'r1.jpg',
        contentType: 'image/jpeg',
        width: 800,
        height: 600,
      },
    })
    expect(first.url).toBe(permanentUrl(ownerId, 'r1.jpg'))
    expect(first.fileName).toBe('r1.jpg')
    expect(typeof first.createdAt).toBe('string')

    await owner.transactions.attachments.add({
      transactionId,
      attachment: { url: permanentUrl(ownerId, 'r2.pdf') },
    })

    const listed = await owner.transactions.list({})
    const entry = listed.entries.find((item) => item.id === transactionId)
    expect(entry?.attachments).toHaveLength(2)
    expect(entry?.attachments.map((item) => item.url)).toContain(
      permanentUrl(ownerId, 'r1.jpg'),
    )

    const overview = await owner.overview.get({})
    const recent = overview.recent.find((item) => item.id === transactionId)
    expect(recent?.attachments).toHaveLength(2)
  })

  it('rejects add for GROUP rows and foreign accounts', async () => {
    const owner = caller(ownerId)
    await expect(
      owner.transactions.attachments.add({
        transactionId: groupRowId,
        attachment: { url: permanentUrl(ownerId, 'shared.jpg') },
      }),
    ).rejects.toThrow()

    const other = caller(otherId)
    await expect(
      other.transactions.attachments.add({
        transactionId,
        attachment: { url: permanentUrl(otherId, 'sneaky.jpg') },
      }),
    ).rejects.toThrow()
    await expect(
      other.transactions.attachments.remove({
        transactionId,
        attachmentId: 'whatever',
      }),
    ).rejects.toThrow()
  })

  it('removes an attachment and cascades the rest on transaction delete', async () => {
    const owner = caller(ownerId)
    const listed = await owner.transactions.list({})
    const entry = listed.entries.find((item) => item.id === transactionId)
    const [victim] = entry?.attachments ?? []
    expect(victim).toBeDefined()

    await owner.transactions.attachments.remove({
      transactionId,
      attachmentId: victim!.id,
    })
    expect(
      await prisma.personalAttachment.count({
        where: { personalTransactionId: transactionId },
      }),
    ).toBe(1)

    await owner.transactions.delete({ id: transactionId })
    expect(
      await prisma.personalAttachment.count({
        where: { personalTransactionId: transactionId },
      }),
    ).toBe(0)
  })

  it('cascades attachment rows on account delete', async () => {
    const doomed = await caller(otherId).transactions.create({
      requestId: crypto.randomUUID(),
      entry: {
        kind: 'EXPENSE',
        amount: 700,
        date: todayIso(),
        categoryId: 'general',
        title: 'Doomed',
      },
    })
    await caller(otherId).transactions.attachments.add({
      transactionId: doomed.id,
      attachment: { url: permanentUrl(otherId, 'doomed.jpg') },
    })
    expect(
      await prisma.personalAttachment.count({
        where: { accountId: otherId },
      }),
    ).toBe(1)

    await prisma.user.delete({ where: { id: otherId } })
    expect(
      await prisma.personalAttachment.count({
        where: { accountId: otherId },
      }),
    ).toBe(0)
  })
})
