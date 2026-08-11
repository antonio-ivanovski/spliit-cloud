import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeleteGroupDialog } from '@/app/groups/[groupId]/edit/delete-group-dialog'
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

describe('DeleteGroupDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requires the exact group name and removes the old checkbox confirmation', async () => {
    mockDesktopMediaQuery()
    const onConfirm = vi.fn()
    const { user } = render(
      <DeleteGroupDialog
        open
        groupName="Weekend trip"
        deleting={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const confirmButton = screen.getByRole('button', { name: /delete group/i })
    expect(confirmButton).toBeDisabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.getByText(/to permanently delete the group/i),
    ).toHaveTextContent(
      'To permanently delete the group Weekend trip, type its name exactly as shown below.',
    )

    const input = screen.getByRole('textbox', { name: /enter the name/i })
    expect(input).toHaveAttribute('placeholder', 'Type “Weekend trip” here')
    await user.type(input, 'Weekend Trip')
    expect(confirmButton).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Weekend trip')
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
