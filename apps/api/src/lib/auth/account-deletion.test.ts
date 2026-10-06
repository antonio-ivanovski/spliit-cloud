import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'
import {
  ACCOUNT_DELETION_GRACE_MS,
  cancelAccountDeletion,
  executeAccountDeletion,
  getDeletionPreview,
  requestAccountDeletion,
  resolvePreviewGroupName,
} from './account-deletion'

const { sendJobMock, getApiBossForWriteMock } = vi.hoisted(() => ({
  sendJobMock: vi.fn(async () => 'job-1'),
  getApiBossForWriteMock: vi.fn(async () => ({})),
}))

vi.mock('@spliit/jobs', () => ({
  JOB_NAMES: { EXECUTE_ACCOUNT_DELETION: 'account-deletion.execute' },
  sendJob: sendJobMock,
  bossTransactionDb: () => ({ executeSql: vi.fn() }),
}))

vi.mock('../api/boss', () => ({
  getApiBoss: vi.fn(async () => null),
  getApiBossForWrite: getApiBossForWriteMock,
}))

const NOW = new Date('2026-09-22T12:00:00Z')
const FRESH_SESSION = new Date('2026-09-22T11:50:00Z')
const STALE_SESSION = new Date('2026-01-01T00:00:00Z')

const account = {
  id: 'acct-1',
  name: 'Alice',
  email: 'alice@example.com',
  image: null,
}

beforeEach(() => {
  sendJobMock.mockClear()
  sendJobMock.mockResolvedValue('job-1')
  getApiBossForWriteMock.mockClear()
  prismaMock.$queryRaw.mockResolvedValue([{ acquired: true }])
})

describe('requestAccountDeletion', () => {
  it('rejects stale sessions before touching the database', async () => {
    await expect(
      requestAccountDeletion({
        accountId: account.id,
        email: account.email,
        keepDisplayName: false,
        sessionCreatedAt: STALE_SESSION,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'sessionNotFresh' })
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a mismatched confirmation email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    await expect(
      requestAccountDeletion({
        accountId: account.id,
        email: 'someone-else@example.com',
        keepDisplayName: false,
        sessionCreatedAt: FRESH_SESSION,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'emailMismatch' })
  })

  it('rejects when a request is already pending', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'PENDING',
    } as never)
    await expect(
      requestAccountDeletion({
        accountId: account.id,
        email: account.email,
        keepDisplayName: false,
        sessionCreatedAt: FRESH_SESSION,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'alreadyRequested' })
    expect(sendJobMock).not.toHaveBeenCalled()
  })

  it('records the request, schedules execution after the grace period, and notifies', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue(
      null as never,
    )
    prismaMock.accountDeletionRequest.create.mockResolvedValue({} as never)
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)

    const result = await requestAccountDeletion({
      accountId: account.id,
      email: '  ALICE@example.com ',
      keepDisplayName: true,
      sessionCreatedAt: FRESH_SESSION,
      now: NOW,
    })

    expect(result.executeAt).toEqual(
      new Date(NOW.getTime() + ACCOUNT_DELETION_GRACE_MS),
    )
    expect(prismaMock.accountDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: account.id,
        emailSnapshot: account.email,
        displayNameSnapshot: account.name,
        keepDisplayName: true,
        status: 'PENDING',
      }),
    })
    expect(sendJobMock).toHaveBeenCalledWith(
      expect.anything(),
      'account-deletion.execute',
      { accountId: account.id, generation: expect.any(String) },
      expect.objectContaining({
        singletonKey: expect.stringContaining(
          `account-deletion:${account.id}:`,
        ),
        db: expect.anything(),
      }),
    )
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
      to: account.email,
      subject: 'Your Spliit Cloud account deletion is scheduled',
      text: expect.stringContaining('September 24, 2026 at 12:00:00 PM UTC'),
    })
  })

  it('stores the custom remnant name and settle choice', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue(
      null as never,
    )
    prismaMock.accountDeletionRequest.create.mockResolvedValue({} as never)
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)

    await requestAccountDeletion({
      accountId: account.id,
      email: account.email,
      keepDisplayName: true,
      displayName: '  Al ',
      settleBalances: false,
      sessionCreatedAt: FRESH_SESSION,
      now: NOW,
    })

    expect(prismaMock.accountDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        keepDisplayName: true,
        displayNameOverride: 'Al',
        settleBalances: false,
      }),
    })
  })

  it('ignores the custom name when the name is not kept', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue(
      null as never,
    )
    prismaMock.accountDeletionRequest.create.mockResolvedValue({} as never)
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)

    await requestAccountDeletion({
      accountId: account.id,
      email: account.email,
      keepDisplayName: false,
      displayName: 'Al',
      sessionCreatedAt: FRESH_SESSION,
      now: NOW,
    })

    expect(prismaMock.accountDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ displayNameOverride: null }),
    })
  })

  it.each(['   ', 'x'.repeat(101)])(
    'rejects an invalid custom remnant name (%j)',
    async (displayName) => {
      prismaMock.user.findUnique.mockResolvedValue(account as never)
      await expect(
        requestAccountDeletion({
          accountId: account.id,
          email: account.email,
          keepDisplayName: true,
          displayName,
          sessionCreatedAt: FRESH_SESSION,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: 'invalidDisplayName' })
      expect(sendJobMock).not.toHaveBeenCalled()
    },
  )

  it('does not delete an existing request when scheduling fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue(
      null as never,
    )
    prismaMock.accountDeletionRequest.create.mockResolvedValue({} as never)
    prismaMock.accountDeletionRequest.delete.mockResolvedValue({} as never)
    sendJobMock.mockRejectedValueOnce(new Error('Background jobs are disabled'))

    await expect(
      requestAccountDeletion({
        accountId: account.id,
        email: account.email,
        keepDisplayName: false,
        sessionCreatedAt: FRESH_SESSION,
        now: NOW,
      }),
    ).rejects.toThrow('Background jobs are disabled')
    expect(prismaMock.accountDeletionRequest.delete).not.toHaveBeenCalled()
  })
})

describe('cancelAccountDeletion', () => {
  it('rejects when nothing is pending', async () => {
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue(
      null as never,
    )
    await expect(cancelAccountDeletion(account.id, NOW)).rejects.toMatchObject({
      code: 'noPendingRequest',
    })
  })

  it('does not report cancellation when execution wins the race', async () => {
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'PENDING',
      jobId: null,
      emailSnapshot: account.email,
    } as never)
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({ count: 0 })
    await expect(cancelAccountDeletion(account.id, NOW)).rejects.toMatchObject({
      code: 'noPendingRequest',
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('marks the request cancelled and notifies', async () => {
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'PENDING',
      jobId: null,
      emailSnapshot: account.email,
    } as never)
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({ count: 1 })

    const result = await cancelAccountDeletion(account.id, NOW)

    expect(result).toEqual({ cancelled: true })
    expect(prismaMock.accountDeletionRequest.updateMany).toHaveBeenCalledWith({
      where: { accountId: account.id, generation: null, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: NOW, jobId: null },
    })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
      to: account.email,
      subject: 'Your Spliit Cloud account deletion was cancelled',
    })
  })
})

describe('executeAccountDeletion claim guards', () => {
  function mockNoRequest() {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue(
      null as never,
    )
  }

  it('returns not-found when no request exists', async () => {
    mockNoRequest()
    await expect(
      executeAccountDeletion(account.id, null, NOW),
    ).resolves.toEqual({
      executed: false,
      reason: 'not-found',
    })
  })

  it('returns not-due when the grace period has not elapsed', async () => {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'PENDING',
      executeAt: new Date(NOW.getTime() + 60_000),
    } as never)
    await expect(
      executeAccountDeletion(account.id, null, NOW),
    ).resolves.toEqual({
      executed: false,
      reason: 'not-due',
    })
  })

  it('returns cancelled for a cancelled request', async () => {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'CANCELLED',
      executeAt: NOW,
    } as never)
    await expect(
      executeAccountDeletion(account.id, null, NOW),
    ).resolves.toEqual({
      executed: false,
      reason: 'cancelled',
    })
  })

  it('returns already-done for an executed request', async () => {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'EXECUTED',
      executeAt: NOW,
    } as never)
    await expect(
      executeAccountDeletion(account.id, null, NOW),
    ).resolves.toEqual({
      executed: false,
      reason: 'already-done',
    })
  })

  it('keeps execution irreversible when the first post-claim read fails', async () => {
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.accountDeletionRequest.findUnique.mockRejectedValueOnce(
      new Error('connection lost'),
    )
    await expect(executeAccountDeletion(account.id, null, NOW)).rejects.toThrow(
      'connection lost',
    )
    expect(prismaMock.accountDeletionRequest.update).not.toHaveBeenCalled()
  })

  it('keeps execution irreversible when a deletion step fails', async () => {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      accountId: account.id,
      emailSnapshot: account.email,
      displayNameSnapshot: account.name,
      keepDisplayName: false,
      status: 'EXECUTING',
    } as never)
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.groupMember.findMany.mockRejectedValueOnce(
      new Error('connection lost'),
    )
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)

    await expect(executeAccountDeletion(account.id, null, NOW)).rejects.toThrow(
      'connection lost',
    )
    expect(prismaMock.accountDeletionRequest.update).not.toHaveBeenCalled()
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it('closes the request when the account is already gone', async () => {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      accountId: account.id,
      status: 'EXECUTING',
    } as never)
    prismaMock.user.findUnique.mockResolvedValue(null as never)
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)

    await expect(
      executeAccountDeletion(account.id, null, NOW),
    ).resolves.toEqual({
      executed: false,
      reason: 'account-gone',
    })
    expect(prismaMock.accountDeletionRequest.update).toHaveBeenCalledWith({
      where: { accountId: account.id, generation: null, status: 'EXECUTING' },
      data: { status: 'EXECUTED', executedAt: NOW },
    })
  })
})

describe('executeAccountDeletion success (account without groups)', () => {
  it('removes sessions, the user row, and marks the request executed', async () => {
    prismaMock.accountDeletionRequest.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      accountId: account.id,
      emailSnapshot: account.email,
      displayNameSnapshot: account.name,
      keepDisplayName: true,
      status: 'EXECUTING',
    } as never)
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    prismaMock.expenseComment.findMany.mockResolvedValue([] as never)
    prismaMock.expenseComment.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.groupBudget.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.expenseFileImportSource.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.oauthConsent.findMany.mockResolvedValue([] as never)
    prismaMock.session.deleteMany.mockResolvedValue({ count: 2 } as never)
    prismaMock.verification.deleteMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.activity.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.user.delete.mockResolvedValue(account as never)
    prismaMock.accountDeletionRequest.update.mockResolvedValue({} as never)

    const result = await executeAccountDeletion(account.id, null, NOW)

    expect(result).toEqual({ executed: true })
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: account.id },
    })
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: account.id },
    })
    expect(prismaMock.accountDeletionRequest.update).toHaveBeenCalledWith({
      where: { accountId: account.id, generation: null, status: 'EXECUTING' },
      data: { status: 'EXECUTED', executedAt: NOW, jobId: null },
    })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
      to: account.email,
      subject: 'Your Spliit Cloud account was deleted',
    })
  })
})

describe('getDeletionPreview', () => {
  it('summarizes groups, invites, methods, and the pending request', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account as never)
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.count.mockResolvedValue(2 as never)
    prismaMock.account.findMany.mockResolvedValue([
      { providerId: 'google', password: null },
    ] as never)
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue(
      null as never,
    )
    prismaMock.accountDeletionRequest.findUnique.mockResolvedValue({
      executeAt: new Date(NOW.getTime() + 1000),
      keepDisplayName: false,
      status: 'PENDING',
    } as never)

    const preview = await getDeletionPreview(account.id)

    expect(preview.displayName).toBe('Alice')
    expect(preview.email).toBe(account.email)
    expect(preview.signInMethods).toContain('Google')
    expect(preview.groups).toEqual([])
    expect(preview.pendingSentInvitations).toBe(2)
    expect(preview.request?.keepDisplayName).toBe(false)
  })

  it('throws a plain error for unknown accounts', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never)
    await expect(getDeletionPreview('missing')).rejects.toThrow(
      'Account not found',
    )
  })
})

describe('resolvePreviewGroupName', () => {
  it('returns the raw name for regular groups', () => {
    expect(
      resolvePreviewGroupName(
        { name: 'Trip', groupType: 'GROUP', members: [], invitations: [] },
        'acct-1',
      ),
    ).toBe('Trip')
  })

  it('resolves the peer account name for friend ledgers, not the stored placeholder', () => {
    expect(
      resolvePreviewGroupName(
        {
          name: 'b3c103ac7460462aa04409cc3e33fd1d',
          groupType: 'FRIEND',
          members: [
            { accountId: 'acct-1', account: { name: 'Alice' } },
            { accountId: 'acct-2', account: { name: 'Bob' } },
          ],
          invitations: [],
        },
        'acct-1',
      ),
    ).toBe('Bob')
  })

  it('falls back to the pending invitation name for friend ledgers', () => {
    expect(
      resolvePreviewGroupName(
        {
          name: 'b3c103ac7460462aa04409cc3e33fd1d',
          groupType: 'FRIEND',
          members: [{ accountId: 'acct-1', account: { name: 'Alice' } }],
          invitations: [{ temporaryName: 'Bob', email: null }],
        },
        'acct-1',
      ),
    ).toBe('Bob')
  })

  it('returns empty when nothing identifies the friend peer', () => {
    expect(
      resolvePreviewGroupName(
        {
          name: 'b3c103ac7460462aa04409cc3e33fd1d',
          groupType: 'FRIEND',
          members: [{ accountId: 'acct-1', account: { name: 'Alice' } }],
          invitations: [],
        },
        'acct-1',
      ),
    ).toBe('')
  })
})
