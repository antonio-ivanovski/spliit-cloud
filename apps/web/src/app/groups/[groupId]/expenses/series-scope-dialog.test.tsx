import { afterEach, describe, expect, it, vi } from 'vitest'

import { SeriesScopeDialog } from '@/app/groups/[groupId]/expenses/series-scope-dialog'
import { render, screen } from '@/test/test-utils'

function mockDesktopMediaQuery() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

describe('SeriesScopeDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requires the expense title when confirming a deletion scope', async () => {
    mockDesktopMediaQuery()
    const onConfirm = vi.fn()
    const { user } = render(
      <SeriesScopeDialog
        open
        mode="delete"
        confirmationTarget="Dinner"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const continueButton = screen.getByRole('button', { name: /continue/i })
    expect(continueButton).toBeDisabled()
    expect(screen.getByText(/to confirm this deletion for/i)).toHaveTextContent(
      'To confirm this deletion for Dinner, type the expense title exactly as shown below.',
    )
    await user.type(
      screen.getByRole('textbox', { name: /enter the name/i }),
      'Dinner',
    )
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)

    expect(onConfirm).toHaveBeenCalledWith('OCCURRENCE', false)
  })
})
