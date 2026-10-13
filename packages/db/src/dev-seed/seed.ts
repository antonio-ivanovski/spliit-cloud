import { createHash } from 'node:crypto'

import { computePaidForFromItems, utcToWallTime } from '@spliit/domain'
import {
  calculateRecurrenceDate,
  type RecurringExpenseTemplate,
} from '@spliit/domain/recurring-expenses'

import type { Prisma } from '../generated/prisma/client/client'
import { buildScenarios, seedNamespace, type Scenario } from './fixtures'

export async function seedDevelopmentData(
  tx: Prisma.TransactionClient,
  account: { id: string; name: string },
  action: 'seed' | 'reset' | 'clean',
  today = new Date(),
) {
  const namespace = seedNamespace(account.id)
  const scenarios = buildScenarios(namespace, today)
  const id = (scenario: Scenario, suffix: string) =>
    `${namespace}-${scenario.key}-${suffix}`
  const peerId = (index: number) => `${namespace}-user-${index}`
  // Serialize seed/reset/clean for this account, including concurrent maintainer commands.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${namespace}))`
  if (action !== 'seed') {
    const ledgerIds = scenarios.map((scenario) => id(scenario, 'ledger'))
    await tx.expenseDocument.deleteMany({
      where: { ledgerId: { in: ledgerIds } },
    })
    await tx.splitPreset.deleteMany({
      where: {
        groupId: { in: scenarios.map((scenario) => id(scenario, 'group')) },
      },
    })
    await tx.expense.deleteMany({ where: { ledgerId: { in: ledgerIds } } })
    await tx.ledger.deleteMany({ where: { id: { in: ledgerIds } } })
  }
  if (action === 'clean') return []
  const peerNames = ['Alex Rivera', 'Giulia Rossi', 'Sam 李', 'Morgan Taylor']
  for (const [index, name] of peerNames.entries()) {
    await tx.user.upsert({
      where: { id: peerId(index + 1) },
      update: {},
      create: {
        id: peerId(index + 1),
        name,
        email: `${namespace}-${index + 1}@example.test`,
        emailVerified: true,
      },
    })
  }
  const result: Array<{
    groupId: string
    name: string
    expenses: number
    status: 'created' | 'skipped'
  }> = []
  for (const scenario of scenarios) {
    const groupId = id(scenario, 'group')
    const ledgerId = id(scenario, 'ledger')
    const existing = await tx.group.findUnique({ where: { id: groupId } })
    if (existing) {
      result.push({
        groupId,
        name: scenario.name || 'Friend: Alex Rivera',
        expenses: scenario.expenses.length,
        status: 'skipped',
      })
      continue
    }
    await tx.ledger.create({
      data: {
        id: ledgerId,
        currency: scenario.currency,
        currencyCode: scenario.currencyCode,
      },
    })
    const isPublic = scenario.key === 'trip'
    await tx.group.create({
      data: {
        id: groupId,
        ledgerId,
        name: scenario.name,
        information: scenario.description,
        archived: scenario.archived ?? false,
        groupType: scenario.friend ? 'FRIEND' : 'GROUP',
        friendPairKey: scenario.friend
          ? [account.id, peerId(1)].sort().join(':')
          : null,
        emoji: scenario.friend ? null : scenario.key === 'empty' ? '' : '🧪',
        color: 'teal',
        subgroupsEnabled: scenario.key === 'trip',
        publicViewKey: isPublic
          ? createHash('sha256').update(`${namespace}-public`).digest('hex')
          : null,
      },
    })
    for (let index = 0; index < scenario.people; index++) {
      const unlinked = scenario.key === 'imported' && index > 0
      const memberId = id(scenario, `m${index}`)
      if (!unlinked)
        await tx.groupMember.create({
          data: {
            id: memberId,
            groupId,
            accountId: index === 0 ? account.id : peerId(index),
            role: scenario.friend
              ? 'ADMIN'
              : index === 0
                ? (scenario.viewerRole ?? 'ADMIN')
                : index === 1 && scenario.viewerRole === 'MEMBER'
                  ? 'ADMIN'
                  : 'MEMBER',
            joinedAt: today,
          },
        })
      await tx.ledgerParticipant.create({
        data: {
          id: id(scenario, `p${index}`),
          ledgerId,
          kind: unlinked ? 'UNLINKED_PARTICIPANT' : 'ACCOUNT_MEMBER',
          groupMemberId: unlinked ? null : memberId,
          displayName: unlinked
            ? [
                'Imported Alex',
                'Imported Giulia',
                'Imported Sam',
                'Former traveler',
              ][index - 1]
            : null,
          removedAt: scenario.key === 'imported' && index === 4 ? today : null,
        },
      })
    }
    await tx.accountGroupPreference.create({
      data: {
        id: id(scenario, 'preference'),
        accountId: account.id,
        groupId,
        starred: scenario.key === 'home',
        hidden: scenario.hidden ?? false,
      },
    })
    for (const fixture of scenario.expenses) {
      const expense = fixture.input
      const expenseId = id(scenario, fixture.key)
      const mapShares = (
        rows: Array<{ participant: string; shares: number }>,
      ) =>
        rows.map((row) => ({
          ledgerParticipantId: row.participant,
          shares: row.shares,
        }))
      const paidFor =
        expense.splitMode === 'ITEMIZED'
          ? computePaidForFromItems(
              expense.items ?? [],
              expense.paidFor.map((row) => row.participant),
              expense.amount,
              expense.itemizedRemainder,
              expenseId,
            ).paidFor
          : expense.paidFor
      await tx.expense.create({
        data: {
          id: expenseId,
          ledgerId,
          title: expense.title,
          amount: fixture.conversionSource ? 9200 : expense.amount,
          expenseDate: expense.expenseDate,
          expenseTimeZone: expense.expenseTimeZone,
          categoryId: expense.category,
          notes: expense.notes,
          createdByAccountId:
            scenario.key === 'imported'
              ? null
              : scenario.key === 'member' && fixture.key === 'peer'
                ? peerId(1)
                : account.id,
          createdAt: expense.expenseDate,
          splitMode: expense.splitMode,
          paidBySplitMode: expense.paidBySplitMode,
          conversionSource: fixture.conversionSource,
          originalAmount: fixture.conversionSource ? expense.amount : null,
          originalCurrency: fixture.conversionSource ? 'USD' : null,
          conversionRate: fixture.conversionSource ? 0.92 : null,
          paidByList: { create: mapShares(expense.paidByList) },
          paidFor: { create: mapShares(paidFor) },
          items: {
            create: (expense.items ?? []).map((item, index) => ({
              id: `${expenseId}-item-${index}`,
              title: item.title,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              amount: item.amount,
              splitMode: item.splitMode,
              paidFor: { create: mapShares(item.paidFor) },
            })),
          },
          itemizedRemainder: expense.itemizedRemainder
            ? {
                create: {
                  splitMode: expense.itemizedRemainder.splitMode,
                  allocationMode: expense.itemizedRemainder.allocationMode,
                  paidFor: {
                    create: mapShares(expense.itemizedRemainder.paidFor),
                  },
                },
              }
            : undefined,
        },
      })
      await tx.activity.create({
        data: {
          id: `${expenseId}-activity`,
          ledgerId,
          time: expense.expenseDate,
          type: 'EXPENSE_CREATED',
          actorType: scenario.key === 'imported' ? 'SYSTEM' : 'ACCOUNT',
          actorId:
            scenario.key === 'member' && fixture.key === 'peer'
              ? peerId(1)
              : account.id,
          subjectType: 'EXPENSE',
          subjectId: expenseId,
          visibleInGroupFeed: scenario.key !== 'imported',
          data: {
            kind: 'expense',
            title: expense.title,
            summary: expense.title,
            amount: fixture.conversionSource ? 9200 : expense.amount,
            currencyCode: scenario.currencyCode,
            date: expense.expenseDate.toISOString(),
          },
        },
      })
    }
    if (scenario.key === 'imported') {
      await tx.activity.create({
        data: {
          id: id(scenario, 'import-summary'),
          ledgerId,
          type: 'EXPENSES_IMPORTED',
          actorType: 'ACCOUNT',
          actorId: account.id,
          subjectType: 'GROUP',
          subjectId: groupId,
          data: {
            kind: 'import_summary',
            count: scenario.expenses.length,
            totalAmount: scenario.expenses.reduce(
              (sum, fixture) => sum + fixture.input.amount,
              0,
            ),
            currencyCode: scenario.currencyCode,
            sourceProvider: 'Spliit',
          },
        },
      })
    }
    if (scenario.key === 'home') {
      for (const [index, period] of (
        ['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'] as const
      ).entries()) {
        const start = new Date(today)
        start.setUTCDate(1)
        start.setUTCHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setUTCMonth(end.getUTCMonth() + 1)
        end.setUTCDate(0)
        await tx.groupBudget.create({
          data: {
            id: id(scenario, `budget-${period}`),
            groupId,
            ledgerId,
            name: `${period.toLowerCase()} ${index === 0 ? 'groceries (over budget)' : 'household budget'}`,
            amount: [100, 250000, 4000000, 150000][index]!,
            period,
            timeZone: 'Europe/Rome',
            createdByAccountId: account.id,
            customStartDate: period === 'CUSTOM' ? start : null,
            customEndDate: period === 'CUSTOM' ? end : null,
            categoryScope: index === 0 ? 'SELECTED' : 'ALL',
            categoryNodeIds: index === 0 ? ['groceries'] : [],
            participantScope: index === 3 ? 'SELECTED' : 'ALL',
            participantIds: index === 3 ? [id(scenario, 'p0')] : [],
          },
        })
      }
      for (const [index, status] of (
        ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const
      ).entries()) {
        const frequency = (['MONTHLY', 'WEEKLY', 'DAILY', 'YEARLY'] as const)[
          index
        ]!
        const source = scenario.expenses[index]!.input
        const anchor = new Date(source.expenseDate)
        anchor.setUTCHours(0, 0, 0, 0)
        const template: RecurringExpenseTemplate = {
          title: `Recurring ${frequency.toLowerCase()} bill (${status.toLowerCase()})`,
          categoryId: source.category,
          amount: source.amount,
          originalAmount: null,
          originalCurrency: null,
          conversionRate: null,
          conversionSource: null,
          paidBySplitMode: source.paidBySplitMode,
          splitMode: source.splitMode,
          paidByList: source.paidByList.map((row) => ({
            ledgerParticipantId: row.participant,
            shares: row.shares,
          })),
          paidFor: source.paidFor.map((row) => ({
            ledgerParticipantId: row.participant,
            shares: row.shares,
          })),
          notes: source.notes ?? null,
          items: [],
          itemizedRemainder: null,
        }
        await tx.recurringExpenseSeries.create({
          data: {
            id: id(scenario, `series-${index}`),
            ledgerId,
            creatorAccountId: account.id,
            timeZone: 'Europe/Rome',
            anchorTimeMinutes: utcToWallTime(source.expenseDate, 'Europe/Rome')
              .timeMinutes,
            frequency,
            interval: 1,
            anchorDate: anchor,
            nextOccurrenceDate: calculateRecurrenceDate(
              anchor,
              frequency,
              1,
              2,
            ),
            status,
            endType:
              status === 'COMPLETED'
                ? 'COUNT'
                : status === 'CANCELLED'
                  ? 'DATE'
                  : 'INDEFINITE',
            occurrenceLimit: status === 'COMPLETED' ? 1 : null,
            endDate: status === 'CANCELLED' ? anchor : null,
            template,
          },
        })
        await tx.expense.update({
          where: { id: id(scenario, scenario.expenses[index]!.key) },
          data: {
            title: template.title,
            recurringSeriesId: id(scenario, `series-${index}`),
            recurrenceSequence: 1,
          },
        })
        await tx.activity.update({
          where: {
            id: `${id(scenario, scenario.expenses[index]!.key)}-activity`,
          },
          data: {
            type: 'RECURRING_EXPENSE_CREATED',
            data: {
              kind: 'expense',
              title: template.title,
              summary: template.title,
              amount: source.amount,
              currencyCode: scenario.currencyCode,
              date: source.expenseDate.toISOString(),
              recurrence: {
                seriesId: id(scenario, `series-${index}`),
                frequency,
                interval: 1,
                endType:
                  status === 'COMPLETED'
                    ? 'COUNT'
                    : status === 'CANCELLED'
                      ? 'DATE'
                      : 'INDEFINITE',
              },
            },
          },
        })
      }
      const commentId = id(scenario, 'comment')
      await tx.expenseComment.create({
        data: {
          id: commentId,
          expenseId: id(scenario, 'groceries-0'),
          authorAccountId: peerId(1),
          authorName: 'Alex Rivera',
          text: 'The groceries include shared pantry supplies.\nPlease keep the receipt for our next budget review.',
        },
      })
      await tx.activity.create({
        data: {
          id: id(scenario, 'comment-activity'),
          ledgerId,
          type: 'EXPENSE_COMMENTED',
          actorType: 'ACCOUNT',
          actorId: peerId(1),
          subjectType: 'EXPENSE',
          subjectId: id(scenario, 'groceries-0'),
          expenseCommentId: commentId,
          data: {
            kind: 'expense_comment',
            commentId,
            expenseTitle: 'Weekly groceries 🥑',
            authorName: 'Alex Rivera',
            excerpt: 'The groceries include shared pantry supplies.',
          },
        },
      })
      const presetId = id(scenario, 'preset')
      await tx.splitPreset.create({
        data: {
          id: presetId,
          groupId,
          scopeKey: 'GROUP',
          name: 'Household 40/30/20/10',
          nameKey: 'household 40/30/20/10',
          target: 'PAID_FOR',
          splitMode: 'BY_PERCENTAGE',
          participants: {
            create: [4000, 3000, 2000, 1000].map((shares, index) => ({
              participantId: id(scenario, `p${index}`),
              shares,
            })),
          },
        },
      })
      await tx.group.update({
        where: { id: groupId },
        data: { defaultPaidForPresetId: presetId },
      })
      const personalPresetId = id(scenario, 'personal-preset')
      await tx.splitPreset.create({
        data: {
          id: personalPresetId,
          groupId,
          ownerAccountId: account.id,
          scopeKey: `ACCOUNT:${account.id}`,
          name: 'I pay',
          nameKey: 'i pay',
          target: 'PAID_BY',
          splitMode: 'EVENLY',
          participants: {
            create: [{ participantId: id(scenario, 'p0'), shares: 1 }],
          },
        },
      })
      await tx.accountGroupPreference.update({
        where: { id: id(scenario, 'preference') },
        data: {
          paidByDefaultMode: 'PRESET',
          paidByDefaultPresetId: personalPresetId,
        },
      })
    }
    if (scenario.key === 'trip') {
      for (const [index, name] of ['Team North', 'Team South'].entries())
        await tx.subgroup.create({
          data: {
            id: id(scenario, `subgroup-${index}`),
            groupId,
            name,
            members: {
              create: [index * 2, index * 2 + 1].map((person) => ({
                ledgerParticipantId: id(scenario, `p${person}`),
              })),
            },
          },
        })
      await tx.ledgerParticipant.create({
        data: {
          id: id(scenario, 'pending-guest'),
          ledgerId,
          displayName: 'Morgan (invited)',
        },
      })
      for (const status of [
        'PENDING',
        'ACCEPTED',
        'DECLINED',
        'REVOKED',
      ] as const)
        await tx.groupInvitation.create({
          data: {
            id: id(scenario, `invite-${status}`),
            groupId,
            email:
              status === 'PENDING'
                ? `${namespace}-4@example.test`
                : status === 'ACCEPTED'
                  ? `${namespace}-1@example.test`
                  : `${namespace}-${status.toLowerCase()}@example.test`,
            temporaryName: `${status.toLowerCase()} guest`,
            status,
            invitedById: account.id,
            revokedAt: status === 'REVOKED' ? today : null,
            ledgerParticipantId:
              status === 'PENDING'
                ? id(scenario, 'pending-guest')
                : status === 'ACCEPTED'
                  ? id(scenario, 'p1')
                  : null,
            acceptedById: status === 'ACCEPTED' ? peerId(1) : null,
            acceptedAt: status === 'ACCEPTED' ? today : null,
          },
        })
    }
    result.push({
      groupId,
      name: scenario.name || 'Friend: Alex Rivera',
      expenses: scenario.expenses.length,
      status: 'created',
    })
  }
  return result
}
