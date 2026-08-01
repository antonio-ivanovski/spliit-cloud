import { describe, expect, it } from 'vitest'

import {
  formatFeedbackDiagnostics,
  sanitizeFeedbackRoute,
} from './feedback-diagnostics'

describe('sanitizeFeedbackRoute', () => {
  it.each([
    ['/', '/'],
    ['/feedback', '/feedback'],
    ['/groups/group-secret/expenses', '/groups/:groupId/:section'],
    [
      '/groups/group-secret/expenses/expense-secret/edit',
      '/groups/:groupId/expenses/:expenseId/edit',
    ],
    [
      '/groups/group-secret/budgets/budget-secret?token=invite-secret',
      '/groups/:groupId/budgets/:budgetId',
    ],
    ['/unknown/private-value', '/unknown/:other'],
  ])('sanitizes %s as %s', (pathname, expected) => {
    expect(sanitizeFeedbackRoute(pathname)).toBe(expected)
  })
})

describe('formatFeedbackDiagnostics', () => {
  it('includes safe environment details without raw route identifiers', () => {
    const diagnostics = formatFeedbackDiagnostics({
      origin: 'https://example.test',
      pathname:
        '/groups/group-secret/expenses/expense-secret?token=invite-secret#private',
      buildSha: 'abc123',
      userAgent: 'Example Browser',
      locale: 'en-US',
      timeZone: 'Europe/Skopje',
      viewportWidth: 1280,
      viewportHeight: 720,
      standalone: false,
    })

    expect(diagnostics).toContain('Instance: https://example.test')
    expect(diagnostics).toContain('Build: abc123')
    expect(diagnostics).toContain(
      'Screen: /groups/:groupId/expenses/:expenseId',
    )
    expect(diagnostics).toContain('Browser / OS: Example Browser')
    expect(diagnostics).toContain('Viewport: 1280x720')
    expect(diagnostics).toContain('Display mode: browser')
    expect(diagnostics).not.toMatch(
      /group-secret|expense-secret|invite-secret|token=/,
    )
  })

  it('uses a safe fallback when build metadata is unavailable', () => {
    const diagnostics = formatFeedbackDiagnostics({
      origin: 'http://localhost:3000',
      pathname: '/feedback',
      userAgent: 'Example Browser',
      locale: 'en-US',
      timeZone: 'UTC',
      viewportWidth: 390,
      viewportHeight: 844,
      standalone: true,
    })

    expect(diagnostics).toContain('Build: unknown')
    expect(diagnostics).toContain('Display mode: standalone')
  })
})
