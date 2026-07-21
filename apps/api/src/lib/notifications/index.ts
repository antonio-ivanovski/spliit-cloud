import { ActivityNotificationCoordinator } from './coordinator'
import { setDefaultActivityNotificationDispatchers } from './dispatcher'

setDefaultActivityNotificationDispatchers([
  new ActivityNotificationCoordinator(),
])
