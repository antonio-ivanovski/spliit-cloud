import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FeedbackPage from '@/app/feedback'
import { render, screen } from '@/test/test-utils'

const diagnostics = [
  'Spliit Cloud diagnostics',
  'Instance: https://example.test',
  'Screen: /groups/:groupId/expenses/:expenseId',
].join('\n')

vi.mock('@/lib/feedback-diagnostics', () => ({
  getBrowserFeedbackDiagnostics: () => diagnostics,
}))

describe('FeedbackPage', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders public guidance and the three GitHub issue forms', () => {
    render(<FeedbackPage />)

    expect(
      screen.getByRole('heading', { name: 'Help shape Spliit Cloud' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Reports are public on GitHub')).toBeVisible()
    expect(screen.getByText('Protect your privacy')).toBeVisible()

    const expectedLinks = [
      ['Open bug report', 'bug_report.yml'],
      ['Open idea form', 'idea.yml'],
      ['Open feedback form', 'feedback.yml'],
    ] as const

    for (const [name, template] of expectedLinks) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute(
        'href',
        `https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=${template}`,
      )
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('copies the visible safe diagnostics', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    render(<FeedbackPage />)

    expect(screen.getByText(/Spliit Cloud diagnostics/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))

    expect(writeText).toHaveBeenCalledWith(diagnostics)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
  })

  it('keeps diagnostics selectable when clipboard access fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    )
    render(<FeedbackPage />)

    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Clipboard access failed. Select and copy the diagnostics manually.',
    )
    expect(screen.getByText(/Spliit Cloud diagnostics/)).toBeVisible()
  })
})
