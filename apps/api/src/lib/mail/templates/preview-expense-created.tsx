import { ExpenseActivityEmail } from './expense-activity'

const props = {
  eventType: 'EXPENSE_CREATED' as const,
  brandBaseUrl: 'https://spliit.app',
  groupDisplayName: 'Roadtrip 2026',
  actorName: 'Alice',
  title: 'Dinner',
  amountStr: 'EUR 45.00',
  date: '2026-07-02',
  expenseUrl: 'https://spliit.app/groups/grp-1/expenses/exp-1',
}

export default function Preview() {
  return <ExpenseActivityEmail {...props} />
}

Preview.PreviewProps = props
