import { setDefaultActivityNotificationDispatchers } from './dispatcher'
import { ExpenseEmailActivityNotificationDispatcher } from './expense-email-dispatcher'

setDefaultActivityNotificationDispatchers([
  new ExpenseEmailActivityNotificationDispatcher(),
])
