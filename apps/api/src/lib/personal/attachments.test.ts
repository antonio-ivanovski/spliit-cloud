import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { usePrismaMemoryStore } from '../../test/prisma-memory-store'
import { prismaMock, prisma$Transaction, resetPrisma } from '../../test/state'
import { personalTransactionsRouter } from '../../trpc/routers/personal/transactions'
import { uploadsRouter } from '../../trpc/routers/uploads'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async () => 'https://s3.example.com/presigned-upload-url',
  ),
}))

const mockS3Client = vi.hoisted(() => ({
  send: vi.fn(),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return mockS3Client
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
  CopyObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
  HeadObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
}))

const BUCKET_HOST = 'https://spliit-test-bucket.s3.us-east-1.amazonaws.com'
const permanentUrl = (accountId: string, name: string) =>
  `${BUCKET_HOST}/documents/personal/${accountId}/${name}`
const tmpUrl = (accountId: string, name: string) =>
  `${BUCKET_HOST}/tmp/personal/${accountId}/${name}`

function personalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pt-1',
    createdAt: new Date('2026-10-20T00:00:00Z'),
    updatedAt: new Date('2026-10-20T00:00:00Z'),
    accountId: 'acct-1',
    kind: 'EXPENSE',
    amount: 4200,
    currencyCode: 'USD',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    date: new Date('2026-10-20T00:00:00Z'),
    categoryId: 'groceries',
    title: 'Market',
    note: null,
    version: 1,
    source: 'PERSONAL',
    sourceExpenseId: null,
    sourceGroupId: null,
    sourceGroupName: null,
    sourceDetachedAt: null,
    fileImportSource: null,
    ...overrides,
  }
}

function seed(rows: { tx?: Array<Record<string, unknown>> }) {
  resetPrisma()
  usePrismaMemoryStore({
    personalTransaction: rows.tx ?? [personalRow()],
  })
}

function caller(accountId: string) {
  return personalTransactionsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
  } as never)
}

function uploadsCaller(accountId: string) {
  return uploadsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
  } as never)
}

beforeEach(() => {
  mockS3Client.send.mockReset()
})

describe('personal.transactions.attachments', () => {
  it('adds an already-permanent attachment without S3 promotion', async () => {
    seed({})
    const url = permanentUrl('acct-1', 'receipt.jpg')

    const result = await caller('acct-1').attachments.add({
      transactionId: 'pt-1',
      attachment: { url, fileName: 'receipt.jpg', contentType: 'image/jpeg' },
    })

    expect(result.url).toBe(url)
    expect(result.fileName).toBe('receipt.jpg')
    expect(result.contentType).toBe('image/jpeg')
    // No copy: the URL was already permanent.
    expect(
      mockS3Client.send.mock.calls.some(
        ([input]) =>
          (input as { CopySource?: string }).CopySource !== undefined,
      ),
    ).toBe(false)
  })

  it('rejects attachments on GROUP-sourced rows', async () => {
    seed({
      tx: [personalRow({ source: 'GROUP', sourceExpenseId: 'exp-1' })],
    })

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        attachment: { url: permanentUrl('acct-1', 'receipt.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects foreign-account and foreign-prefix URLs', async () => {
    seed({})

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        attachment: { url: permanentUrl('acct-2', 'receipt.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        // Group document prefix: never attachable to personal entries.
        attachment: { url: `${BUCKET_HOST}/documents/doc.jpg` },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('enforces the 10-attachment cap', async () => {
    seed({})
    const { prisma } = await import('@spliit/db')
    for (let index = 0; index < 10; index += 1) {
      await prisma.personalAttachment.create({
        data: {
          id: `pa-${index}`,
          personalTransactionId: 'pt-1',
          accountId: 'acct-1',
          url: permanentUrl('acct-1', `r${index}.jpg`),
          createdAt: new Date('2026-10-20T00:00:00Z'),
        },
      })
    }

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        attachment: { url: permanentUrl('acct-1', 'extra.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('honors expectedVersion with CONFLICT', async () => {
    seed({ tx: [personalRow({ version: 2 })] })

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        expectedVersion: 1,
        attachment: { url: permanentUrl('acct-1', 'receipt.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('holds the 10-cap under concurrent adds without expectedVersion', async () => {
    seed({})
    const { prisma } = await import('@spliit/db')
    for (let index = 0; index < 9; index += 1) {
      await prisma.personalAttachment.create({
        data: {
          id: `pa-${index}`,
          personalTransactionId: 'pt-1',
          accountId: 'acct-1',
          url: permanentUrl('acct-1', `r${index}.jpg`),
          createdAt: new Date('2026-10-20T00:00:00Z'),
        },
      })
    }
    // Emulate the `SELECT ... FOR UPDATE` row lock Postgres provides by
    // serializing the transaction bodies: each add then counts after the
    // previous one committed. (The in-memory store has no locking, so without
    // this every add would count before any insert.)
    let chain = Promise.resolve()
    prisma$Transaction.mockImplementation((input: unknown) => {
      if (typeof input !== 'function') return Promise.resolve(input)
      const run = chain.then(() =>
        (input as (tx: unknown) => Promise<unknown>)(prismaMock),
      )
      chain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    })

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        caller('acct-1').attachments.add({
          transactionId: 'pt-1',
          attachment: { url: permanentUrl('acct-1', `burst-${index}.jpg`) },
        }),
      ),
    )

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    )
    const rejected = settled.filter((item) => item.status === 'rejected')
    expect(rejected).toHaveLength(4)
    for (const item of rejected) {
      expect((item as PromiseRejectedResult).reason).toMatchObject({
        code: 'BAD_REQUEST',
      })
    }
    expect(
      await prisma.personalAttachment.count({
        where: { personalTransactionId: 'pt-1' },
      }),
    ).toBe(10)
    const parent = await prisma.personalTransaction.findUniqueOrThrow({
      where: { id: 'pt-1' },
    })
    expect(parent.version).toBe(2)
  })

  it('deletes a newly promoted object when the transaction conflicts', async () => {
    seed({ tx: [personalRow({ version: 2 })] })
    mockS3Client.send.mockImplementation(
      async (input: { Key?: string; CopySource?: string }) => {
        if (input.CopySource) return {}
        if (input.Key?.startsWith('documents/')) {
          throw Object.assign(new Error('NotFound'), {
            $metadata: { httpStatusCode: 404 },
          })
        }
        return {}
      },
    )

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        expectedVersion: 1,
        attachment: { url: tmpUrl('acct-1', 'staged.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    // The promotion created the permanent object, so the failed transaction
    // removes it again — and inserts no row.
    const deletedKeys = vi
      .mocked(DeleteObjectCommand)
      .mock.calls.map(([input]) => (input as { Key?: string }).Key)
    expect(deletedKeys).toContain('documents/personal/acct-1/staged.jpg')
    const { prisma } = await import('@spliit/db')
    expect(
      await prisma.personalAttachment.count({
        where: { personalTransactionId: 'pt-1' },
      }),
    ).toBe(0)
  })

  it('never deletes a pre-existing destination on conflict', async () => {
    seed({ tx: [personalRow({ version: 2 })] })
    mockS3Client.send.mockResolvedValue({})

    await expect(
      caller('acct-1').attachments.add({
        transactionId: 'pt-1',
        expectedVersion: 1,
        attachment: { url: permanentUrl('acct-1', 'receipt.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(DeleteObjectCommand).not.toHaveBeenCalled()
  })

  it('promotes tmp keys to the permanent prefix on add', async () => {
    seed({})
    mockS3Client.send.mockImplementation(
      async (input: { Key?: string; CopySource?: string }) => {
        if (input.CopySource) return {}
        if (input.Key?.startsWith('documents/')) {
          throw Object.assign(new Error('NotFound'), {
            $metadata: { httpStatusCode: 404 },
          })
        }
        return {}
      },
    )

    const result = await caller('acct-1').attachments.add({
      transactionId: 'pt-1',
      attachment: { url: tmpUrl('acct-1', 'staged.jpg') },
    })

    expect(result.url).toBe(
      `${BUCKET_HOST}/documents/personal/acct-1/staged.jpg`,
    )
    const copyInput = mockS3Client.send.mock.calls
      .map(([input]) => input as { CopySource?: string; Key?: string })
      .find((input) => input.CopySource !== undefined)
    expect(copyInput?.Key).toBe('documents/personal/acct-1/staged.jpg')
  })

  it('removes an attachment, bumps the version, and deletes the S3 object', async () => {
    seed({})
    mockS3Client.send.mockResolvedValue({})
    const { prisma } = await import('@spliit/db')
    await prisma.personalAttachment.create({
      data: {
        id: 'pa-1',
        personalTransactionId: 'pt-1',
        accountId: 'acct-1',
        url: permanentUrl('acct-1', 'receipt.jpg'),
        createdAt: new Date('2026-10-20T00:00:00Z'),
      },
    })

    const result = await caller('acct-1').attachments.remove({
      transactionId: 'pt-1',
      attachmentId: 'pa-1',
      expectedVersion: 1,
    })

    expect(result).toEqual({ ok: true })
    expect(
      mockS3Client.send.mock.calls.some(
        ([input]) =>
          (input as { Key?: string }).Key ===
          'documents/personal/acct-1/receipt.jpg',
      ),
    ).toBe(true)
  })

  it('rejects remove on version mismatch without deleting', async () => {
    seed({ tx: [personalRow({ version: 2 })] })
    mockS3Client.send.mockResolvedValue({})
    const { prisma } = await import('@spliit/db')
    await prisma.personalAttachment.create({
      data: {
        id: 'pa-1',
        personalTransactionId: 'pt-1',
        accountId: 'acct-1',
        url: permanentUrl('acct-1', 'receipt.jpg'),
        createdAt: new Date('2026-10-20T00:00:00Z'),
      },
    })

    await expect(
      caller('acct-1').attachments.remove({
        transactionId: 'pt-1',
        attachmentId: 'pa-1',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mockS3Client.send).not.toHaveBeenCalled()
  })

  it('keeps the S3 object while another row still references the URL', async () => {
    seed({ tx: [personalRow(), personalRow({ id: 'pt-2' })] })
    mockS3Client.send.mockResolvedValue({})
    const { prisma } = await import('@spliit/db')
    const shared = permanentUrl('acct-1', 'shared.jpg')
    for (const [id, transactionId] of [
      ['pa-1', 'pt-1'],
      ['pa-2', 'pt-2'],
    ]) {
      await prisma.personalAttachment.create({
        data: {
          id,
          personalTransactionId: transactionId,
          accountId: 'acct-1',
          url: shared,
          createdAt: new Date('2026-10-20T00:00:00Z'),
        },
      })
    }

    await caller('acct-1').attachments.remove({
      transactionId: 'pt-1',
      attachmentId: 'pa-1',
    })

    // The survivor still references the object: no S3 delete.
    expect(DeleteObjectCommand).not.toHaveBeenCalled()
    expect(
      await prisma.personalAttachment.findUnique({ where: { id: 'pa-2' } }),
    ).not.toBeNull()

    await caller('acct-1').attachments.remove({
      transactionId: 'pt-2',
      attachmentId: 'pa-2',
    })

    const deletedKeys = vi
      .mocked(DeleteObjectCommand)
      .mock.calls.map(([input]) => (input as { Key?: string }).Key)
    expect(deletedKeys).toContain('documents/personal/acct-1/shared.jpg')
  })

  it('keeps S3 objects shared with a surviving entry on transaction delete', async () => {
    seed({ tx: [personalRow(), personalRow({ id: 'pt-2' })] })
    mockS3Client.send.mockResolvedValue({})
    const { prisma } = await import('@spliit/db')
    const shared = permanentUrl('acct-1', 'shared.jpg')
    await prisma.personalAttachment.create({
      data: {
        id: 'pa-1',
        personalTransactionId: 'pt-1',
        accountId: 'acct-1',
        url: shared,
        createdAt: new Date('2026-10-20T00:00:00Z'),
      },
    })
    await prisma.personalAttachment.create({
      data: {
        id: 'pa-2',
        personalTransactionId: 'pt-2',
        accountId: 'acct-1',
        url: shared,
        createdAt: new Date('2026-10-20T00:00:00Z'),
      },
    })
    await prisma.personalAttachment.create({
      data: {
        id: 'pa-3',
        personalTransactionId: 'pt-1',
        accountId: 'acct-1',
        url: permanentUrl('acct-1', 'only-pt-1.jpg'),
        createdAt: new Date('2026-10-20T00:00:00Z'),
      },
    })

    await caller('acct-1').delete({ id: 'pt-1' })

    const deletedKeys = vi
      .mocked(DeleteObjectCommand)
      .mock.calls.map(([input]) => (input as { Key?: string }).Key)
    expect(deletedKeys).toContain('documents/personal/acct-1/only-pt-1.jpg')
    expect(deletedKeys).not.toContain('documents/personal/acct-1/shared.jpg')
    expect(
      await prisma.personalAttachment.findUnique({ where: { id: 'pa-2' } }),
    ).not.toBeNull()
  })

  it('isolates attachments by account', async () => {
    seed({})
    const { prisma } = await import('@spliit/db')
    await prisma.personalAttachment.create({
      data: {
        id: 'pa-1',
        personalTransactionId: 'pt-1',
        accountId: 'acct-1',
        url: permanentUrl('acct-1', 'receipt.jpg'),
        createdAt: new Date('2026-10-20T00:00:00Z'),
      },
    })

    // Another account owns no such transaction.
    await expect(
      caller('acct-2').attachments.remove({
        transactionId: 'pt-1',
        attachmentId: 'pa-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // And cannot attach through someone else's row.
    await expect(
      caller('acct-2').attachments.add({
        transactionId: 'pt-1',
        attachment: { url: permanentUrl('acct-2', 'receipt.jpg') },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('deletes the transaction, its rows, and every S3 object', async () => {
    seed({})
    mockS3Client.send.mockResolvedValue({})
    const { prisma } = await import('@spliit/db')
    for (const name of ['a.jpg', 'b.jpg']) {
      await prisma.personalAttachment.create({
        data: {
          id: `pa-${name}`,
          personalTransactionId: 'pt-1',
          accountId: 'acct-1',
          url: permanentUrl('acct-1', name),
          createdAt: new Date('2026-10-20T00:00:00Z'),
        },
      })
    }

    const result = await caller('acct-1').delete({ id: 'pt-1' })

    expect(result).toEqual({ ok: true })
    const deletedKeys = mockS3Client.send.mock.calls.map(
      ([input]) => (input as { Key?: string }).Key,
    )
    expect(deletedKeys).toContain('documents/personal/acct-1/a.jpg')
    expect(deletedKeys).toContain('documents/personal/acct-1/b.jpg')
  })

  it('keeps excluding GROUP rows from delete', async () => {
    seed({
      tx: [personalRow({ source: 'GROUP', sourceExpenseId: 'exp-1' })],
    })

    await expect(caller('acct-1').delete({ id: 'pt-1' })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    )
  })
})

describe('uploads.personalPresign', () => {
  it('mints an account-scoped tmp key', async () => {
    const result = await uploadsCaller('acct-9').personalPresign({
      fileName: 'receipt.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    })

    expect(result.key).toMatch(/^tmp\/personal\/acct-9\/.+\.jpg$/)
    expect(result.fileUrl).toContain(result.key)
    expect(result.uploadUrl).toBe('https://s3.example.com/presigned-upload-url')
  })

  it('rejects unsupported types without minting', async () => {
    await expect(
      uploadsCaller('acct-9').personalPresign({
        fileName: 'receipt.exe',
        contentType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
