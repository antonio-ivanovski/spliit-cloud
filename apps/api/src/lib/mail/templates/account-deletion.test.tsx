import { describe, expect, it, vi } from 'vitest'

import {
  renderAccountDeletionCancelledEmail,
  renderAccountDeletionExecutedEmail,
  renderAccountDeletionRequestedEmail,
} from './account-deletion'

vi.mock('../../auth/urls', () => ({
  getWebBaseUrl: () => 'https://spliit.test',
}))

describe('account deletion emails', () => {
  it('renders the scheduled notice with the execution date, timezone, and review/backup/feedback links', async () => {
    const rendered = await renderAccountDeletionRequestedEmail({
      executeAtLabel: 'September 24, 2026 at 2:23:00 PM UTC',
      keepDisplayName: false,
    })
    expect(rendered.subject).toBe(
      'Your Spliit Cloud account deletion is scheduled',
    )
    expect(rendered.text).toContain('September 24, 2026 at 2:23:00 PM UTC')
    expect(rendered.text).toContain('“Deleted member”')
    for (const path of [
      '/account/delete',
      '/feedback',
      '/account/settings#account-export',
    ]) {
      const url = `https://spliit.test${path}`
      expect(rendered.text).toContain(url)
      expect(rendered.html).toContain(`href="${url}"`)
    }
    for (const copy of [
      '48-hour cancellation period',
      'Once deletion starts, it cannot be cancelled or undone.',
      'UTC',
    ]) {
      expect(rendered.text).toContain(copy)
      expect(rendered.html).toContain(copy)
    }
    expect(rendered.text).not.toContain('#account-deletion')
    expect(rendered.html).toContain('Your account deletion is scheduled')
  })

  it('mentions the kept name when keepDisplayName is set', async () => {
    const rendered = await renderAccountDeletionRequestedEmail({
      executeAtLabel: 'September 24, 2026 at 2:23:00 PM UTC',
      keepDisplayName: true,
    })
    expect(rendered.text).toContain(
      'kept using the name you chose for that shared history',
    )
  })

  it('renders the cancelled notice', async () => {
    const rendered = await renderAccountDeletionCancelledEmail()
    expect(rendered.subject).toBe(
      'Your Spliit Cloud account deletion was cancelled',
    )
    expect(rendered.text).toContain(
      'account remains active and nothing was deleted',
    )
    expect(rendered.text).toContain('https://spliit.test/account/settings')
    expect(rendered.html).toContain(
      'href="https://spliit.test/account/settings"',
    )
    expect(rendered.html).toContain('deletion was cancelled')
  })

  it('renders the executed notice', async () => {
    const rendered = await renderAccountDeletionExecutedEmail()
    expect(rendered.subject).toBe('Your Spliit Cloud account was deleted')
    expect(rendered.text).toContain('permanently deleted')
    expect(rendered.html).toContain('account was deleted')
  })
})
