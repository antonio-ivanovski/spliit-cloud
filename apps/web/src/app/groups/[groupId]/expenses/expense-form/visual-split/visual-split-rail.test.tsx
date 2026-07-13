import { getCurrency } from '@/lib/currency'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { allocationBoundaries, createAllocation } from '../allocation-engine'
import type { VisualSplitParticipant } from './types'
import { VisualSplitRail, type RailRow } from './visual-split-rail'

const usd = getCurrency('USD')!
const participants: VisualSplitParticipant[] = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
  { id: 'carol', name: 'Carol' },
]

function buildAllocation() {
  const result = createAllocation(10_000, [
    { id: 'alice', value: 5000 },
    { id: 'bob', value: 3000 },
    { id: 'carol', value: 2000 },
  ])
  if (!result.ok) throw new Error('fixture allocation failed')
  return result.state
}

function buildRailRows(): RailRow[] {
  return [
    {
      id: 'alice',
      value: 5000,
      locked: false,
      participant: participants[0],
      colorIndex: 0,
      width: 50,
      index: 0,
    },
    {
      id: 'bob',
      value: 3000,
      locked: false,
      participant: participants[1],
      colorIndex: 1,
      width: 30,
      index: 1,
    },
    {
      id: 'carol',
      value: 2000,
      locked: false,
      participant: participants[2],
      colorIndex: 2,
      width: 20,
      index: 2,
    },
  ]
}

function renderRail(
  overrides: Partial<React.ComponentProps<typeof VisualSplitRail>> = {},
) {
  const allocation = overrides.allocation ?? buildAllocation()
  const railRows = overrides.railRows ?? buildRailRows()
  const onSetActiveBoundary = vi.fn()
  const onQueuePointerMove = vi.fn()
  const onFinishPointerMove = vi.fn()
  const onUpdateBoundary = vi.fn()
  const railRef = { current: null } as React.RefObject<HTMLDivElement | null>
  const props: React.ComponentProps<typeof VisualSplitRail> = {
    mode: 'BY_PERCENTAGE',
    currency: usd,
    readOnly: false,
    editable: true,
    railRef,
    railRows,
    allocation,
    boundaries: allocationBoundaries(allocation),
    activeBoundary: null,
    participantById: new Map(participants.map((p) => [p.id, p])),
    onSetActiveBoundary,
    onQueuePointerMove,
    onFinishPointerMove,
    onUpdateBoundary,
    ...overrides,
  }
  const utils = render(<VisualSplitRail {...props} />)
  return {
    onSetActiveBoundary,
    onQueuePointerMove,
    onFinishPointerMove,
    onUpdateBoundary,
    ...utils,
  }
}

describe('VisualSplitRail', () => {
  it('renders one segment per participant with their value in the title', () => {
    renderRail()
    expect(screen.getByTitle('Alice: 50%')).toBeInTheDocument()
    expect(screen.getByTitle('Bob: 30%')).toBeInTheDocument()
    expect(screen.getByTitle('Carol: 20%')).toBeInTheDocument()
  })

  it('renders one slider between each adjacent pair when editable', () => {
    renderRail()
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })

  it('hides sliders in read-only mode', () => {
    renderRail({ readOnly: true })
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('hides sliders when not editable (EVENLY)', () => {
    renderRail({ editable: false })
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('navigates the focused boundary with ArrowLeft/Right', async () => {
    const { user, onUpdateBoundary } = renderRail()
    const slider = screen.getAllByRole('slider')[0]
    slider.focus()
    await user.keyboard('{ArrowRight}')
    expect(onUpdateBoundary).toHaveBeenCalled()
    const call = onUpdateBoundary.mock.calls[0]
    expect(call[0]).toBe(0)
  })

  it('announces the active boundary value while focused', () => {
    renderRail({ activeBoundary: 0 })
    expect(screen.getByText(/Alice 50% · Bob 30%/)).toBeInTheDocument()
  })

  it('routes pointer-move through the throttle callback', async () => {
    const { user, onQueuePointerMove } = renderRail()
    const slider = screen.getAllByRole('slider')[0]
    slider.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 100,
        top: 0,
        bottom: 0,
        width: 100,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    slider.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }),
    )
    await user.pointer([
      { target: slider, keys: '[MouseLeft>]' },
      { target: slider, coords: { x: 30, y: 0 } },
    ])
    expect(onQueuePointerMove).toHaveBeenCalled()
  })
})
