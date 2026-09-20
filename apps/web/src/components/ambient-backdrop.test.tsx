import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { GroupAmbientAccent } from '@/app/groups/[groupId]/group-ambient-accent'
import { render, screen } from '@/test/test-utils'

import {
  AmbientAccentProvider,
  AmbientBackdrop,
  useAmbientAccent,
  useSetAmbientAccent,
} from './ambient-backdrop'

function AccentProbe() {
  const accent = useAmbientAccent()
  return <div data-testid="accent">{accent ?? 'none'}</div>
}

function SetAccent({ hex }: { hex: string | null }) {
  const setAmbientAccent = useSetAmbientAccent()
  useEffect(() => {
    setAmbientAccent(hex)
  }, [hex, setAmbientAccent])
  return null
}

describe('AmbientBackdrop', () => {
  it('renders the default orbs without a tint when no accent is set', () => {
    const { container } = render(
      <AmbientAccentProvider>
        <AmbientBackdrop />
      </AmbientAccentProvider>,
    )

    const backdrop = container.querySelector('.ambient-backdrop')
    expect(backdrop).not.toBeNull()
    expect(backdrop).not.toHaveAttribute('data-group-tinted')
    expect(backdrop?.querySelectorAll('.ambient-backdrop__orb')).toHaveLength(2)
  })

  it('exposes the accent as --group-accent with the tint flag when set', () => {
    const { container } = render(
      <AmbientAccentProvider>
        <SetAccent hex="#14b8a6" />
        <AmbientBackdrop />
      </AmbientAccentProvider>,
    )

    const backdrop = container.querySelector('.ambient-backdrop')
    expect(backdrop).toHaveAttribute('data-group-tinted', 'true')
    expect(backdrop?.getAttribute('style')).toContain('--group-accent: #14b8a6')
  })
})

describe('GroupAmbientAccent', () => {
  function Harness({
    color,
    groupType,
    mounted = true,
  }: {
    color: string | null | undefined
    groupType: 'GROUP' | 'FRIEND' | null | undefined
    mounted?: boolean
  }) {
    return (
      <AmbientAccentProvider>
        {mounted ? (
          <GroupAmbientAccent color={color} groupType={groupType} />
        ) : null}
        <AccentProbe />
      </AmbientAccentProvider>
    )
  }

  it('pushes the resolved palette hex for a colored group', () => {
    render(<Harness color="teal" groupType="GROUP" />)

    expect(screen.getByTestId('accent')).toHaveTextContent('#14b8a6')
  })

  it('resolves custom hex colors', () => {
    render(<Harness color="#FF0000" groupType="GROUP" />)

    expect(screen.getByTestId('accent')).toHaveTextContent('#ff0000')
  })

  it('keeps the default backdrop for colorless groups and friend ledgers', () => {
    const { rerender } = render(<Harness color={null} groupType="GROUP" />)
    expect(screen.getByTestId('accent')).toHaveTextContent('none')

    rerender(<Harness color="teal" groupType="FRIEND" />)
    expect(screen.getByTestId('accent')).toHaveTextContent('none')
  })

  it('clears the accent on unmount so the tint never leaks', () => {
    const { rerender } = render(
      <Harness color="teal" groupType="GROUP" mounted />,
    )
    expect(screen.getByTestId('accent')).toHaveTextContent('#14b8a6')

    rerender(<Harness color="teal" groupType="GROUP" mounted={false} />)
    expect(screen.getByTestId('accent')).toHaveTextContent('none')
  })
})
