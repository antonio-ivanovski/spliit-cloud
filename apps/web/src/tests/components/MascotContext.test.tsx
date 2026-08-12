import { Plus } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MascotProvider,
  useMascotActions,
  useMascotController,
  useMascotState,
  type MascotAction,
} from '@/components/mascot/mascot-context'
import { act, fireEvent, render, screen } from '@/test/test-utils'

const action: MascotAction = {
  id: 'create',
  label: 'Create',
  icon: Plus,
  onSelect: () => undefined,
}
const actions = [action]

function StateProbe() {
  const mascot = useMascotState()
  const controller = useMascotController()
  return (
    <>
      <output data-testid="reaction">{mascot?.reaction}</output>
      <output data-testid="actions">{mascot?.actions.length}</output>
      <button type="button" onClick={() => controller.react('success', 500)}>
        Celebrate
      </button>
    </>
  )
}

function Registration() {
  useMascotActions('test', actions)
  return null
}

describe('MascotProvider', () => {
  afterEach(() => vi.useRealTimers())

  it('returns transient reactions to idle after their duration', () => {
    vi.useFakeTimers()
    render(
      <MascotProvider>
        <StateProbe />
      </MascotProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Celebrate' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('success')

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByTestId('reaction')).toHaveTextContent('idle')
  })

  it('publishes registered actions and removes them on cleanup', () => {
    const { rerender } = render(
      <MascotProvider>
        <Registration />
        <StateProbe />
      </MascotProvider>,
    )
    expect(screen.getByTestId('actions')).toHaveTextContent('1')

    rerender(
      <MascotProvider>
        <StateProbe />
      </MascotProvider>,
    )
    expect(screen.getByTestId('actions')).toHaveTextContent('0')
  })
})
