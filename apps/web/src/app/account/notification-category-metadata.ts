import {
  NotificationCategory,
  type NotificationCategory as Category,
} from '@spliit/domain/notifications'

export type NotificationRow = {
  id: string
  category: Category
  titleKey:
    | 'rows.addedToGroup.title'
    | 'rows.addedAsFriend.title'
    | 'rows.newExpense.title'
    | 'rows.recurringExpense.title'
    | 'rows.expenseChanged.title'
    | 'rows.newComment.title'
    | 'rows.budgetAlert.title'
    | 'rows.weeklySummary.title'
    | 'rows.cloudNews.title'
  descriptionKey:
    | 'rows.addedToGroup.description'
    | 'rows.addedAsFriend.description'
    | 'rows.newExpense.description'
    | 'rows.recurringExpense.description'
    | 'rows.expenseChanged.description'
    | 'rows.newComment.description'
    | 'rows.budgetAlert.description'
    | 'rows.weeklySummary.description'
    | 'rows.cloudNews.description'
  comingSoon?: boolean
}

export const NOTIFICATION_ROWS = {
  groups: [
    {
      id: 'added-to-group',
      category: NotificationCategory.GROUP_INVITE_RECEIVED,
      titleKey: 'rows.addedToGroup.title',
      descriptionKey: 'rows.addedToGroup.description',
    },
    {
      id: 'added-as-friend',
      category: NotificationCategory.FRIEND_ADDED,
      titleKey: 'rows.addedAsFriend.title',
      descriptionKey: 'rows.addedAsFriend.description',
    },
    {
      id: 'budget-alert',
      category: NotificationCategory.BUDGET_ALERT,
      titleKey: 'rows.budgetAlert.title',
      descriptionKey: 'rows.budgetAlert.description',
    },
  ],
  expenses: [
    {
      id: 'new-expense',
      category: NotificationCategory.EXPENSE_CREATED,
      titleKey: 'rows.newExpense.title',
      descriptionKey: 'rows.newExpense.description',
    },
    {
      id: 'recurring-expense-created',
      category: NotificationCategory.RECURRING_EXPENSE_CREATED,
      titleKey: 'rows.recurringExpense.title',
      descriptionKey: 'rows.recurringExpense.description',
    },
    {
      id: 'expense-changed',
      category: NotificationCategory.EXPENSE_CHANGED,
      titleKey: 'rows.expenseChanged.title',
      descriptionKey: 'rows.expenseChanged.description',
    },
    {
      id: 'new-comment',
      category: NotificationCategory.EXPENSE_COMMENT,
      titleKey: 'rows.newComment.title',
      descriptionKey: 'rows.newComment.description',
    },
  ],
  summaries: [
    {
      id: 'weekly-summary',
      category: NotificationCategory.WEEKLY_SUMMARY,
      titleKey: 'rows.weeklySummary.title',
      descriptionKey: 'rows.weeklySummary.description',
      comingSoon: true,
    },
    {
      id: 'cloud-news',
      category: NotificationCategory.PRODUCT_UPDATES,
      titleKey: 'rows.cloudNews.title',
      descriptionKey: 'rows.cloudNews.description',
      comingSoon: true,
    },
  ],
} as const satisfies Record<string, readonly NotificationRow[]>

export const NOTIFICATION_SECTIONS = [
  { id: 'groups', rows: NOTIFICATION_ROWS.groups },
  { id: 'expenses', rows: NOTIFICATION_ROWS.expenses },
  { id: 'summaries', rows: NOTIFICATION_ROWS.summaries },
] as const

export const NOTIFICATION_CATEGORY_METADATA = Object.fromEntries(
  NOTIFICATION_SECTIONS.flatMap((section) =>
    section.rows.map((row) => [row.category, { ...row, section: section.id }]),
  ),
) as Record<Category, NotificationRow & { section: string }>
