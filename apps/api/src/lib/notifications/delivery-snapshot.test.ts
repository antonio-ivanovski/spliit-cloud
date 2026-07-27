import { NotificationCategory } from '@spliit/domain/notifications'
import { describe, expect, it } from 'vitest'
import {
  DELIVERY_SNAPSHOT_KINDS,
  deliverySnapshotV1Schema,
} from './delivery-snapshot'

const baseActor = { id: 'acct-alice', name: 'Alice' }

const baseRecipient = {
  accountId: 'acct-bob',
  displayName: 'Bob',
}

const baseExpense = {
  id: 'exp-1',
  description: 'Dinner',
  amount: 4500,
  currencyCode: 'EUR',
}

const baseGroup = { id: 'grp-1', name: 'Trip', type: 'GROUP' }

const baseRecurrence = {
  frequency: 'MONTHLY',
  interval: 2,
  rule: 'Every 2 months, 12 total',
}

const baseLink = '/groups/grp-1/expenses/exp-1'

function emailSnapshotForKind(kind: string): Record<string, unknown> {
  const base = {
    version: 1,
    occurredAt: '2026-07-02T12:00:00Z',
    actor: baseActor,
    recipient: baseRecipient,
    unsubscribeCategory: NotificationCategory.EXPENSE_CREATED,
    group: baseGroup,
    link: baseLink,
  }
  switch (kind) {
    case 'expense_created':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CREATED,
        expense: baseExpense,
        date: '2026-07-02',
      }
    case 'expense_updated':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CHANGED,
        expense: baseExpense,
        changedFields: ['amount', 'title'],
      }
    case 'expense_deleted':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CHANGED,
        expense: baseExpense,
        stopped: true,
      }
    case 'expense_comment':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_COMMENT,
        expense: { id: 'exp-1', description: 'Dinner' },
        comment: { id: 'comment-1', excerpt: 'Looks good' },
      }
    case 'recurring_created':
      return {
        ...base,
        kind,
        category: NotificationCategory.RECURRING_EXPENSE_CREATED,
        expense: baseExpense,
        recurrence: baseRecurrence,
        date: '2026-07-02',
      }
    case 'recurring_occurrence':
      return {
        ...base,
        kind,
        category: NotificationCategory.RECURRING_EXPENSE_CREATED,
        expense: baseExpense,
        recurrence: baseRecurrence,
      }
    case 'recurring_summary':
      return {
        ...base,
        kind,
        category: NotificationCategory.RECURRING_EXPENSE_CREATED,
        title: 'Lunch',
        recurrence: baseRecurrence,
        operation: 'create',
        occurrenceCount: 3,
        dateRange: { start: '2026-07-01', end: '2026-07-03' },
      }
    case 'recurring_stopped':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CHANGED,
        recurrence: baseRecurrence,
        title: 'Lunch',
      }
    case 'import_summary':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CREATED,
        import: { count: 25, source: 'Splitwise' },
        totalAmount: 123450,
        currencyCode: 'EUR',
      }
    case 'category_bulk':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CHANGED,
        count: 3,
        distinctCategories: 2,
      }
    case 'group_activity':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CHANGED,
        action: 'archived',
        summary: 'Group was archived',
      }
    case 'settlement':
      return {
        ...base,
        kind,
        category: NotificationCategory.EXPENSE_CREATED,
        expense: baseExpense,
      }
    case 'invitation':
      return {
        ...base,
        kind,
        category: NotificationCategory.GROUP_INVITE_RECEIVED,
        group: { id: 'grp-1', name: 'Trip' },
        inviterName: 'Alice',
        inviterRole: 'ADMIN',
      }
    case 'friend_added':
      return {
        ...base,
        kind,
        category: NotificationCategory.FRIEND_ADDED,
        group: { id: 'grp-1', name: 'abc123' },
        friendName: 'Alice',
      }
    default:
      throw new Error(`Unknown kind: ${kind}`)
  }
}

function pushSnapshotForKind(kind: string): Record<string, unknown> {
  const base = emailSnapshotForKind(kind)
  const { unsubscribeCategory: _uc, ...rest } = base
  return {
    ...rest,
    push: {
      subscriptionId: 'push-1',
      title: 'Expense created',
      body: 'Alice added an expense',
      url: baseLink,
    },
  }
}

describe('deliverySnapshotV1Schema', () => {
  it('parses a valid email snapshot for every kind', () => {
    for (const kind of DELIVERY_SNAPSHOT_KINDS) {
      const snapshot = emailSnapshotForKind(kind)
      const parsed = deliverySnapshotV1Schema.parse(snapshot)
      expect(parsed.kind).toBe(kind)
      expect(parsed.version).toBe(1)
    }
  })

  it('parses a valid push snapshot for every kind', () => {
    for (const kind of DELIVERY_SNAPSHOT_KINDS) {
      const snapshot = pushSnapshotForKind(kind)
      const parsed = deliverySnapshotV1Schema.parse(snapshot)
      expect(parsed.kind).toBe(kind)
      expect(parsed.push).toBeDefined()
    }
  })

  it('rejects unsupported snapshot versions', () => {
    const snapshot = emailSnapshotForKind('expense_created')
    const invalid = { ...snapshot, version: 99 }
    expect(() => deliverySnapshotV1Schema.parse(invalid)).toThrow()
  })

  it('rejects snapshots missing the required category', () => {
    const snapshot = emailSnapshotForKind('expense_created')
    const { category: _category, ...rest } = snapshot
    expect(() => deliverySnapshotV1Schema.parse(rest)).toThrow()
  })

  it('rejects snapshots missing the required recipient', () => {
    const snapshot = emailSnapshotForKind('expense_created')
    const { recipient: _recipient, ...rest } = snapshot
    expect(() => deliverySnapshotV1Schema.parse(rest)).toThrow()
  })

  it('rejects snapshots missing the required expense fields', () => {
    const snapshot = emailSnapshotForKind('expense_created')
    const { expense: _expense, ...rest } = snapshot
    expect(() => deliverySnapshotV1Schema.parse(rest)).toThrow()
  })

  it('rejects snapshots with an unknown kind discriminator', () => {
    const snapshot = {
      ...emailSnapshotForKind('expense_created'),
      kind: 'mystery_kind',
    }
    expect(() => deliverySnapshotV1Schema.parse(snapshot)).toThrow()
  })

  it('strips top-level push credentials (endpoint, p256dh, auth)', () => {
    const snapshot = pushSnapshotForKind('expense_created')
    snapshot.endpoint = 'https://push.example/abc'
    snapshot.p256dh =
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7CI99NTnomM-K8'
    snapshot.auth = 'tBHItJI5svbpez7KI4CCXg'

    const parsed = deliverySnapshotV1Schema.parse(snapshot)
    expect((parsed as Record<string, unknown>).endpoint).toBeUndefined()
    expect((parsed as Record<string, unknown>).p256dh).toBeUndefined()
    expect((parsed as Record<string, unknown>).auth).toBeUndefined()
  })

  it('strips push credentials nested inside the push presentation block', () => {
    const snapshot = pushSnapshotForKind('expense_created')
    const push = snapshot.push as Record<string, unknown>
    push.endpoint = 'https://push.example/abc'
    push.p256dh =
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7CI99NTnomM-K8'
    push.auth = 'tBHItJI5svbpez7KI4CCXg'

    const parsed = deliverySnapshotV1Schema.parse(snapshot)
    const parsedPush = parsed.push as Record<string, unknown>
    expect(parsedPush.endpoint).toBeUndefined()
    expect(parsedPush.p256dh).toBeUndefined()
    expect(parsedPush.auth).toBeUndefined()
  })

  it('strips push credentials nested inside the recipient object', () => {
    const snapshot = pushSnapshotForKind('expense_created')
    const recipient = snapshot.recipient as Record<string, unknown>
    recipient.endpoint = 'https://push.example/abc'
    recipient.p256dh =
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7CI99NTnomM-K8'
    recipient.auth = 'tBHItJI5svbpez7KI4CCXg'

    const parsed = deliverySnapshotV1Schema.parse(snapshot)
    const parsedRecipient = parsed.recipient as Record<string, unknown>
    expect(parsedRecipient.endpoint).toBeUndefined()
    expect(parsedRecipient.p256dh).toBeUndefined()
    expect(parsedRecipient.auth).toBeUndefined()
  })

  it('never serializes an email address into a snapshot', () => {
    const snapshot = emailSnapshotForKind('expense_created')
    snapshot.email = 'bob@example.com'
    const recipient = snapshot.recipient as Record<string, unknown>
    recipient.email = 'bob@example.com'

    const parsed = deliverySnapshotV1Schema.parse(snapshot)
    expect((parsed as Record<string, unknown>).email).toBeUndefined()
    expect((parsed.recipient as Record<string, unknown>).email).toBeUndefined()
  })

  it('keeps the recipient identity fields required for email delivery', () => {
    const snapshot = emailSnapshotForKind('expense_created')
    const parsed = deliverySnapshotV1Schema.parse(snapshot)
    if (parsed.kind === 'expense_created') {
      expect(parsed.recipient.accountId).toBe('acct-bob')
      expect(parsed.recipient.displayName).toBe('Bob')
      expect(parsed.unsubscribeCategory).toBe(
        NotificationCategory.EXPENSE_CREATED,
      )
    }
  })

  it('keeps the push presentation fields required for push delivery', () => {
    const snapshot = pushSnapshotForKind('expense_created')
    const parsed = deliverySnapshotV1Schema.parse(snapshot)
    if (parsed.kind === 'expense_created') {
      expect(parsed.push).toBeDefined()
      expect(parsed.push.subscriptionId).toBe('push-1')
      expect(parsed.push.title).toBe('Expense created')
      expect(parsed.push.body).toBe('Alice added an expense')
      expect(parsed.push.url).toBe(baseLink)
    }
  })
})
