import { describe, expect, it } from 'vitest'

import { ToastProvider, ToastViewport } from '@/components/ui/toast'
import { render } from '@/test/test-utils'

describe('ToastViewport', () => {
  it('does not intercept pointer input outside visible toasts', () => {
    const { container } = render(
      <ToastProvider>
        <ToastViewport />
      </ToastProvider>,
    )

    expect(container.firstElementChild).toHaveClass('pointer-events-none')
  })
})
