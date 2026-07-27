import { describe, expect, it } from 'vitest'
import {
  getDefaultNotificationChannels,
  getRecommendedNotificationChannels,
  NotificationCategory,
  notificationCategoryForActivityType,
  notificationCategorySchema,
  notificationCategoryValues,
  NotificationChannel,
  notificationChannelsSchema,
  recommendedNotificationChannels,
} from './notifications'

describe('notification preference domain values', () => {
  it('preserves channel order and rejects duplicates', () => {
    expect(
      notificationChannelsSchema.parse([
        NotificationChannel.PUSH,
        NotificationChannel.EMAIL,
      ]),
    ).toEqual([NotificationChannel.PUSH, NotificationChannel.EMAIL])
    expect(() =>
      notificationChannelsSchema.parse([
        NotificationChannel.PUSH,
        NotificationChannel.PUSH,
      ]),
    ).toThrow()
  })

  it('has only compact account-scoped categories', () => {
    expect(notificationCategoryValues).toEqual([
      NotificationCategory.GROUP_INVITE_RECEIVED,
      NotificationCategory.FRIEND_ADDED,
      NotificationCategory.EXPENSE_CREATED,
      NotificationCategory.RECURRING_EXPENSE_CREATED,
      NotificationCategory.EXPENSE_CHANGED,
      NotificationCategory.EXPENSE_COMMENT,
      NotificationCategory.WEEKLY_SUMMARY,
      NotificationCategory.PRODUCT_UPDATES,
    ])
    expect(() => notificationCategorySchema.parse('GLOBAL')).toThrow()
  })

  it('folds imports into created and bulk changes into changed', () => {
    expect(notificationCategoryForActivityType.EXPENSE_CREATED).toBe(
      NotificationCategory.EXPENSE_CREATED,
    )
    expect(notificationCategoryForActivityType.RECURRING_EXPENSE_CREATED).toBe(
      NotificationCategory.RECURRING_EXPENSE_CREATED,
    )
    expect(notificationCategoryForActivityType.EXPENSE_UPDATED).toBe(
      NotificationCategory.EXPENSE_CHANGED,
    )
    expect(notificationCategoryForActivityType.EXPENSES_IMPORTED).toBe(
      NotificationCategory.EXPENSE_CREATED,
    )
    expect(notificationCategoryForActivityType.EXPENSE_COMMENTED).toBe(
      NotificationCategory.EXPENSE_COMMENT,
    )
    expect(notificationCategoryForActivityType.GROUP_UPDATED).toBeUndefined()
  })

  it('keeps group invite email+push and does not adapt push defaults', () => {
    expect(
      getRecommendedNotificationChannels(
        NotificationCategory.GROUP_INVITE_RECEIVED,
        false,
      ),
    ).toEqual([NotificationChannel.EMAIL, NotificationChannel.PUSH])
    expect(
      getRecommendedNotificationChannels(
        NotificationCategory.EXPENSE_CREATED,
        false,
      ),
    ).toEqual([NotificationChannel.PUSH])
    expect(
      getRecommendedNotificationChannels(
        NotificationCategory.FRIEND_ADDED,
        false,
      ),
    ).toEqual([NotificationChannel.EMAIL, NotificationChannel.PUSH])
    expect(Object.keys(recommendedNotificationChannels)).toHaveLength(
      notificationCategoryValues.length,
    )
  })

  it('uses email for accounts without an explicit preference', () => {
    expect(
      getDefaultNotificationChannels(NotificationCategory.EXPENSE_CREATED),
    ).toEqual([NotificationChannel.EMAIL])
    expect(
      getDefaultNotificationChannels(
        NotificationCategory.RECURRING_EXPENSE_CREATED,
      ),
    ).toEqual([NotificationChannel.EMAIL])
    expect(
      getDefaultNotificationChannels(
        NotificationCategory.GROUP_INVITE_RECEIVED,
      ),
    ).toEqual([NotificationChannel.EMAIL])
    expect(
      getDefaultNotificationChannels(NotificationCategory.EXPENSE_COMMENT),
    ).toEqual([NotificationChannel.EMAIL])
    expect(
      getDefaultNotificationChannels(
        NotificationCategory.EXPENSE_COMMENT,
        true,
      ),
    ).toEqual([NotificationChannel.PUSH])
  })
})
