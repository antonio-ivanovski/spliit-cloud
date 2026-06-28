import { render, screen } from '@/test/test-utils'
import { SubmitButton } from '@/components/submit-button'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'

/**
 * A test wrapper that provides react-hook-form context via FormProvider.
 * It wraps children in a <form> with an async onSubmit so that
 * clicking a type="submit" button sets isSubmitting to true.
 */
function TestForm({
  onSubmit = vi.fn().mockResolvedValue(undefined),
  children,
}: {
  onSubmit?: () => Promise<void>
  children: ReactNode
}) {
  const form = useForm()
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FormProvider {...form}>{children}</FormProvider>
    </form>
  )
}

describe('SubmitButton', () => {
  it('renders children normally', () => {
    render(
      <TestForm>
        <SubmitButton loadingContent="Saving…">Save</SubmitButton>
      </TestForm>,
    )
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('shows Loader2 and loadingContent when wrapped in a Form and isSubmitting is true', async () => {
    // Use a deferred promise so isSubmitting stays true until we resolve
    let resolveSubmit!: () => void
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn(() => submitPromise)

    const { user } = render(
      <TestForm onSubmit={onSubmit}>
        <SubmitButton loadingContent="Saving…">Save</SubmitButton>
      </TestForm>,
    )

    // Click the submit button to trigger form submission
    await user.click(screen.getByRole('button'))

    // The button should now show loading state
    expect(screen.getByRole('button').querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('Saving…')

    // Resolve the submission
    resolveSubmit()
    // Wait for state to settle
    await vi.waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Save')
    })
  })

  it('button is disabled while submitting', async () => {
    let resolveSubmit!: () => void
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn(() => submitPromise)

    const { user } = render(
      <TestForm onSubmit={onSubmit}>
        <SubmitButton loadingContent="Saving…">Save</SubmitButton>
      </TestForm>,
    )

    await user.click(screen.getByRole('button'))

    // The button should be disabled while submitting
    expect(screen.getByRole('button')).toBeDisabled()

    resolveSubmit()
    await vi.waitFor(() => {
      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })
})
