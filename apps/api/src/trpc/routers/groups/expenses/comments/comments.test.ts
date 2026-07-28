import { describe, expect, it } from 'vitest'

import '../../../../../test/mocks'
import { prismaMock } from '../../../../../test/state'
import { groupsRouter } from '../../index'

const groupId = 'group-1'
const expenseId = 'expense-1'
const accountId = 'account-1'

function caller(userId = accountId) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'session-1' },
      user: {
        id: userId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
        image: 'alice.png',
      },
    },
  } as never)
}

function activeMember() {
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: 'member-1',
    groupId,
    accountId,
    status: 'ACTIVE',
    role: 'MEMBER',
    ledgerParticipant: null,
  } as never)
}

describe('groups.expenses.comments', () => {
  it('lists oldest-first comments using the public DTO', async () => {
    activeMember()
    prismaMock.expense.findFirst.mockResolvedValue({ id: expenseId } as never)
    prismaMock.expenseComment.findMany.mockResolvedValue([
      {
        id: 'comment-1',
        expenseId,
        authorAccountId: accountId,
        authorName: 'Alice',
        authorAccount: { image: 'alice.png' },
        text: 'First',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'comment-2',
        expenseId,
        authorAccountId: null,
        authorName: 'Former account',
        authorAccount: null,
        text: 'Second',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ] as never)

    const result = await caller().expenses.comments.list({
      groupId,
      expenseId,
    })

    expect(result.comments).toEqual([
      {
        id: 'comment-1',
        body: 'First',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        author: { accountId, name: 'Alice', image: 'alice.png' },
        canDelete: true,
      },
      {
        id: 'comment-2',
        body: 'Second',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        author: { accountId: null, name: 'Former account', image: null },
        canDelete: false,
      },
    ])
  })

  it('trims and atomically creates a comment activity', async () => {
    activeMember()
    prismaMock.expense.findFirst.mockResolvedValue({
      id: expenseId,
      title: 'Dinner',
    } as never)
    prismaMock.expenseComment.create.mockResolvedValue({
      id: 'comment-1',
      expenseId,
      authorAccountId: accountId,
      authorName: 'Alice',
      authorAccount: { image: 'alice.png' },
      text: 'Hello',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as never)
    prismaMock.activity.create.mockResolvedValue({
      id: 'activity-1',
      time: new Date('2026-01-01T00:00:00Z'),
    } as never)

    const result = await caller().expenses.comments.create({
      groupId,
      expenseId,
      body: '  Hello  ',
    })

    expect(result.comment.body).toBe('Hello')
    expect(prismaMock.expenseComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: 'Hello' }),
      }),
    )
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'EXPENSE_COMMENTED',
          subjectType: 'EXPENSE',
          subjectId: expenseId,
          expenseCommentId: 'comment-1',
        }),
      }),
    )
  })

  it('rejects writes to archived groups', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      ledgerId: 'ledger-1',
      archived: true,
      ledger: { currencyCode: null },
    } as never)
    activeMember()

    await expect(
      caller().expenses.comments.create({
        groupId,
        expenseId,
        body: 'Hello',
      }),
    ).rejects.toThrow(/archived/i)
    expect(prismaMock.expenseComment.create).not.toHaveBeenCalled()
  })

  it('rejects comments longer than 500 characters', async () => {
    await expect(
      caller().expenses.comments.create({
        groupId,
        expenseId,
        body: 'x'.repeat(501),
      }),
    ).rejects.toThrow()
    expect(prismaMock.expenseComment.create).not.toHaveBeenCalled()
  })

  it('allows deletion only by the author and scopes missing comments', async () => {
    activeMember()
    prismaMock.expenseComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      expenseId,
      authorAccountId: 'other-account',
    } as never)
    await expect(
      caller().expenses.comments.delete({
        groupId,
        expenseId,
        commentId: 'comment-1',
      }),
    ).rejects.toThrow(/author/i)
    expect(prismaMock.expenseComment.delete).not.toHaveBeenCalled()

    prismaMock.expenseComment.findFirst.mockResolvedValue(null)
    await expect(
      caller().expenses.comments.delete({
        groupId,
        expenseId: 'other-expense',
        commentId: 'comment-1',
      }),
    ).rejects.toThrow(/not found/i)
  })
})
