import { APP_VERSION } from '@/generated/app-version'

const UNKNOWN_VERSION = 'unknown'

type FeedbackDiagnosticsInput = {
  origin: string
  pathname: string
  buildVersion?: string
  userAgent: string
  locale: string
  timeZone: string
  viewportWidth: number
  viewportHeight: number
  standalone: boolean
}

const exactRoutes = new Set([
  '/',
  '/account/settings',
  '/auth/complete-profile',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/expenses',
  '/feedback',
  '/friends/create',
  '/groups',
  '/groups/create',
  '/groups/import',
  '/imprint',
  '/oauth/consent',
  '/oauth/login',
  '/privacy',
  '/support',
  '/terms',
  '/unsubscribe',
])

const dynamicRoutes: ReadonlyArray<[RegExp, string]> = [
  [/^\/groups\/bulk-categorize\/[^/]+\/?$/, '/groups/bulk-categorize/:groupId'],
  [
    /^\/groups\/[^/]+\/expenses\/[^/]+\/edit\/?$/,
    '/groups/:groupId/expenses/:expenseId/edit',
  ],
  [
    /^\/groups\/[^/]+\/expenses\/[^/]+\/?$/,
    '/groups/:groupId/expenses/:expenseId',
  ],
  [
    /^\/groups\/[^/]+\/budgets\/[^/]+\/edit\/?$/,
    '/groups/:groupId/budgets/:budgetId/edit',
  ],
  [
    /^\/groups\/[^/]+\/budgets\/[^/]+\/?$/,
    '/groups/:groupId/budgets/:budgetId',
  ],
  [
    /^\/groups\/[^/]+\/(expenses|balances|budgets|activity|stats|members|edit)\/?$/,
    '/groups/:groupId/:section',
  ],
  [/^\/groups\/[^/]+\/?$/, '/groups/:groupId'],
]

export function sanitizeFeedbackRoute(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || '/'
  const normalized = path.length > 1 ? path.replace(/\/$/, '') : path

  if (exactRoutes.has(normalized)) return normalized

  for (const [pattern, route] of dynamicRoutes) {
    if (pattern.test(normalized)) return route
  }

  const topLevelSegment = normalized.split('/').filter(Boolean)[0]
  return topLevelSegment ? `/${topLevelSegment}/:other` : '/:other'
}

export function formatVersionLine(buildVersion?: string): string {
  return `Version: ${buildVersion?.trim() || UNKNOWN_VERSION}`
}

export function formatFeedbackDiagnostics({
  origin,
  pathname,
  buildVersion = UNKNOWN_VERSION,
  userAgent,
  locale,
  timeZone,
  viewportWidth,
  viewportHeight,
  standalone,
}: FeedbackDiagnosticsInput): string {
  return [
    'Spliit Cloud diagnostics',
    `Instance: ${origin}`,
    formatVersionLine(buildVersion),
    `Screen: ${sanitizeFeedbackRoute(pathname)}`,
    `Browser / OS: ${userAgent}`,
    `Locale: ${locale}`,
    `Time zone: ${timeZone}`,
    `Viewport: ${viewportWidth}x${viewportHeight}`,
    `Display mode: ${standalone ? 'standalone' : 'browser'}`,
  ].join('\n')
}

function getTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  } catch {
    return 'unknown'
  }
}

function isStandalone(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    iosNavigator.standalone === true
  )
}

export function getBrowserFeedbackDiagnostics(): string {
  return formatFeedbackDiagnostics({
    origin: window.location.origin,
    pathname: window.location.pathname,
    buildVersion: APP_VERSION,
    userAgent: navigator.userAgent,
    locale: navigator.language || 'unknown',
    timeZone: getTimeZone(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    standalone: isStandalone(),
  })
}
