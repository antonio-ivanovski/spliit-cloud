import { ExpenseImportSummaryEmail } from './expense-activity'

const props = {
  brandBaseUrl: 'https://spliit.app',
  groupDisplayName: 'Roadtrip 2026',
  actorName: 'Alice',
  count: 25,
  sourceProvider: 'Splitwise',
  totalStr: 'EUR 1234.50',
  groupUrl: 'https://spliit.app/groups/grp-1',
}

export default function Preview() {
  return <ExpenseImportSummaryEmail {...props} />
}

Preview.PreviewProps = props
