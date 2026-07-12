import { QueryErrorState } from '@/components/query-error-state'
import { render, screen } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('QueryErrorState', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('explains that data is unavailable offline and offers retry/back actions', async () => {
    const onRetry = vi.fn()
    const onBack = vi.fn()
    const { user } = render(
      <QueryErrorState onRetry={onRetry} onBack={onBack} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This data is not available offline yet',
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await user.click(screen.getByRole('button', { name: 'Go back' }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
  })
})
