import { useState } from 'react'

import {
  TypedDestructiveConfirmation,
  useTypedConfirmationValue,
} from '@/components/typed-destructive-confirmation'
import { render, screen } from '@/test/test-utils'

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [value, setValue] = useState('')
  return (
    <TypedDestructiveConfirmation
      kind="deleteExpense"
      targetName="Dinner"
      value={value}
      onValueChange={setValue}
      onConfirm={onConfirm}
    />
  )
}

function ResetHarness({
  open,
  targetName,
}: {
  open: boolean
  targetName: string
}) {
  const [value, setValue] = useTypedConfirmationValue(`${open}:${targetName}`)
  return (
    <TypedDestructiveConfirmation
      kind="deleteExpense"
      targetName={targetName}
      value={value}
      onValueChange={setValue}
    />
  )
}

describe('TypedDestructiveConfirmation', () => {
  it('requires an exact case-sensitive name before Enter can confirm', async () => {
    const onConfirm = vi.fn()
    const { user } = render(<Harness onConfirm={onConfirm} />)
    const input = screen.getByRole('textbox', { name: /enter the name/i })

    await user.type(input, 'dinner')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Doesn’t match. Type Dinner exactly.',
    )
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'D')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.type(input, 'inner')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.type(input, ' ')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()

    await user.keyboard('{Backspace}')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows the target and copies it without filling or confirming', async () => {
    const onConfirm = vi.fn()
    const { user } = render(<Harness onConfirm={onConfirm} />)
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    expect(
      screen.getByText(/to permanently delete the expense/i),
    ).toHaveTextContent(
      'To permanently delete the expense Dinner, type its title exactly as shown below.',
    )
    await user.click(screen.getByRole('button', { name: /copy name/i }))

    expect(writeTextSpy).toHaveBeenCalledWith('Dinner')
    expect(screen.getByText('Copied')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('uses a compact accessible input described by the inline prompt', () => {
    render(<Harness onConfirm={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: /enter the name/i })
    const promptId = input.getAttribute('aria-describedby')

    expect(input).toHaveAttribute('placeholder', 'Type “Dinner” here')
    expect(promptId).toBeTruthy()
    expect(document.getElementById(promptId!)).toHaveTextContent('Dinner')
    expect(
      screen.queryByText(/the name must match exactly/i),
    ).not.toBeInTheDocument()
  })

  it('clears the value when the dialog identity or target changes', async () => {
    const { user, rerender } = render(<ResetHarness open targetName="Dinner" />)
    const input = screen.getByRole('textbox')

    await user.type(input, 'Dinner')
    expect(input).toHaveValue('Dinner')

    rerender(<ResetHarness open={false} targetName="Dinner" />)
    expect(screen.getByRole('textbox')).toHaveValue('')

    await user.type(screen.getByRole('textbox'), 'Dinner')
    rerender(<ResetHarness open targetName="Lunch" />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})
