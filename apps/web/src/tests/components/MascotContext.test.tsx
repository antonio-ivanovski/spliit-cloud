import { Plus } from 'lucide-react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MascotProvider,
  useMascotActions,
  useMascotBusy,
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
      <button type="button" onClick={() => controller.react('failure', 500)}>
        Fail
      </button>
      <button type="button" onClick={() => controller.react('thinking')}>
        Think
      </button>
      <button type="button" onClick={() => controller.react('idle')}>
        Idle
      </button>
    </>
  )
}

function Registration() {
  useMascotActions('test', actions)
  return null
}

function ThinkingProbe({ busy }: { busy: boolean }) {
  const mascot = useMascotState()
  const controller = useMascotController()
  useMascotBusy('flow', busy)
  return (
    <>
      <output data-testid="reaction">{mascot?.reaction}</output>
      <button type="button" onClick={() => controller.react('thinking')}>
        Think
      </button>
      <button type="button" onClick={() => controller.react('idle')}>
        Idle
      </button>
    </>
  )
}

function BusyToggle() {
  const [busy, setBusy] = useState(true)
  const mascot = useMascotState()
  const controller = useMascotController()
  useMascotBusy('flow', busy)
  return (
    <>
      <output data-testid="reaction">{mascot?.reaction}</output>
      <button type="button" onClick={() => controller.react('thinking')}>
        Think
      </button>
      <button type="button" onClick={() => setBusy(false)}>
        Clear busy
      </button>
    </>
  )
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

  it('returns thinking to idle after the safety timeout', () => {
    vi.useFakeTimers()
    render(
      <MascotProvider>
        <ThinkingProbe busy />
      </MascotProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Think' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('thinking')

    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(screen.getByTestId('reaction')).toHaveTextContent('idle')
  })

  it('clears thinking when the last busy owner drops', () => {
    render(
      <MascotProvider>
        <BusyToggle />
      </MascotProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Think' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('thinking')

    fireEvent.click(screen.getByRole('button', { name: 'Clear busy' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('idle')
  })

  it('does not let idle cancel an in-flight success reaction', () => {
    vi.useFakeTimers()
    render(
      <MascotProvider>
        <StateProbe />
      </MascotProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Celebrate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Idle' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('success')

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByTestId('reaction')).toHaveTextContent('idle')
  })

  it('does not let idle cancel an in-flight failure reaction', () => {
    vi.useFakeTimers()
    render(
      <MascotProvider>
        <StateProbe />
      </MascotProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Idle' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('failure')

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByTestId('reaction')).toHaveTextContent('idle')
  })

  it('still lets idle clear thinking', () => {
    render(
      <MascotProvider>
        <ThinkingProbe busy />
      </MascotProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Think' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('thinking')

    fireEvent.click(screen.getByRole('button', { name: 'Idle' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('idle')
  })
})
