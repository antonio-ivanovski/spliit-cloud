import { setDefaultActivityNotificationDispatchers } from './dispatcher'
import { ExpenseActivityNotificationRouter } from './expense-router'

setDefaultActivityNotificationDispatchers([
  new ExpenseActivityNotificationRouter(),
])
