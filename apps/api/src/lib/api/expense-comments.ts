import { prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import {
  buildExpenseCommentActivityData,
  logActivity,
  planNotificationForActivity,
} from './activities'
import { randomId } from './shared'

export type ExpenseCommentListItem = {
  id: string
  expenseId: string
  authorAccountId: string | null
  authorName: string
  authorImage: string | null
  text: string
  createdAt: Date
}

async function groupLedgerId(groupId: string): Promise<string | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  return group?.ledgerId ?? null
}

export async function getExpenseComments(
  groupId: string,
  expenseId: string,
): Promise<ExpenseCommentListItem[] | null> {
  const ledgerId = await groupLedgerId(groupId)
  if (!ledgerId) return null
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ledgerId },
    select: { id: true },
  })
  if (!expense) return null
  return prisma.expenseComment
    .findMany({
      where: { expenseId: expense.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        expenseId: true,
        authorAccountId: true,
        authorName: true,
        authorAccount: { select: { image: true } },
        text: true,
        createdAt: true,
      },
    })
    .then((comments) =>
      comments.map(({ authorAccount, ...comment }) => ({
        ...comment,
        authorImage: authorAccount?.image ?? null,
      })),
    )
}

export async function createExpenseComment(args: {
  groupId: string
  expenseId: string
  authorAccountId: string
  authorName: string
  text: string
}) {
  const result = await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({
      where: { id: args.groupId },
      select: { ledgerId: true },
    })
    if (!group?.ledgerId) return null
    const expense = await tx.expense.findFirst({
      where: { id: args.expenseId, ledgerId: group.ledgerId },
      select: { id: true, title: true },
    })
    if (!expense) return null

    const comment = await tx.expenseComment.create({
      data: {
        id: randomId(),
        expenseId: expense.id,
        authorAccountId: args.authorAccountId,
        authorName: args.authorName,
        text: args.text,
      },
      select: {
        id: true,
        expenseId: true,
        authorAccountId: true,
        authorName: true,
        text: true,
        createdAt: true,
        authorAccount: { select: { image: true } },
      },
    })
    const activityData = buildExpenseCommentActivityData({
      commentId: comment.id,
      expenseTitle: expense.title,
      authorName: args.authorName,
      excerpt: args.text,
    })
    const activity = await logActivity(
      args.groupId,
      {
        type: 'EXPENSE_COMMENTED',
        actor: { type: 'ACCOUNT', id: args.authorAccountId },
        subject: { type: 'EXPENSE', id: expense.id },
        data: activityData,
        expenseCommentId: comment.id,
      },
      tx,
    )
    await planNotificationForActivity(tx, activity)
    const { authorAccount, ...commentFields } = comment
    return {
      comment: {
        ...commentFields,
        authorImage: authorAccount?.image ?? null,
      },
      activity,
      activityData,
    }
  })
  if (!result) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' })
  }
  return result
}

export async function findExpenseComment(args: {
  groupId: string
  expenseId: string
  commentId: string
}) {
  const ledgerId = await groupLedgerId(args.groupId)
  if (!ledgerId) return null
  return prisma.expenseComment.findFirst({
    where: {
      id: args.commentId,
      expenseId: args.expenseId,
      expense: { ledgerId },
    },
    select: {
      id: true,
      expenseId: true,
      authorAccountId: true,
    },
  })
}

export async function deleteExpenseComment(commentId: string): Promise<void> {
  await prisma.expenseComment.delete({ where: { id: commentId } })
}
