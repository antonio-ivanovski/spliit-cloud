import { setDefaultActivityNotificationDispatchers } from './dispatcher'
import { ExpenseEmailActivityNotificationDispatcher } from './expense-email-dispatcher'

let registered = false

if (!registered) {
  registered = true
  setDefaultActivityNotificationDispatchers([
    new ExpenseEmailActivityNotificationDispatcher(),
  ])
}
