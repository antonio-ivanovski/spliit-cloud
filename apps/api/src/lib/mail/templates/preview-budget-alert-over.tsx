import { BudgetAlertEmail } from './budget-alert'

const props = {
  brandBaseUrl: 'https://spliit.app',
  budgetName: 'Groceries',
  groupName: 'Roadtrip 2026',
  usedStr: 'USD 250.00',
  limitStr: 'USD 200.00',
  percentage: 125,
  periodRange: '07.26',
  alertType: 'OVER' as const,
  budgetUrl: 'https://spliit.app/groups/grp-1/budgets/bgt-1',
}

export default function Preview() {
  return <BudgetAlertEmail {...props} />
}

Preview.PreviewProps = props
