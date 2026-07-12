import { registerSW } from 'virtual:pwa-register'

// Register immediately so the app shell is precached during the first visit,
// and let the plugin reload controlled tabs when a new worker activates.
registerSW({ immediate: true })
