import { BudgetAlertEmail } from './budget-alert'

const props = {
  brandBaseUrl: 'https://spliit.app',
  budgetName: 'Groceries',
  groupName: 'Roadtrip 2026',
  usedStr: 'USD 180.00',
  limitStr: 'USD 200.00',
  percentage: 90,
  periodRange: '01.07 – 31.07',
  alertType: 'TRENDING_OVER' as const,
  budgetUrl: 'https://spliit.app/groups/grp-1/budgets/bgt-1',
}

export default function Preview() {
  return <BudgetAlertEmail {...props} />
}

Preview.PreviewProps = props
