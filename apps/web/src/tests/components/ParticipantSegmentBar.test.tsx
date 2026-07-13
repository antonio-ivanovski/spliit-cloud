import {
  ParticipantSegmentBar,
  participantSegmentColor,
} from '@/components/participant-segment-bar'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const EUR = {
  code: 'EUR',
  symbol: '€',
  decimal_digits: 2,
  rounding: 0,
}

describe('ParticipantSegmentBar', () => {
  it('renders proportional segments, stack avatars, and caller-provided legend content', () => {
    render(
      <ParticipantSegmentBar
        rows={[
          {
            id: 'ada',
            name: 'Ada',
            amount: 50,
            colorIndex: 2,
          },
          {
            id: 'grace',
            name: 'Grace',
            amount: 30,
            colorClass: 'bg-fuchsia-500',
          },
          { id: 'katherine', name: 'Katherine', amount: 20 },
        ]}
        currency={EUR}
        locale="en-US"
      >
        <p>Ada owes Grace €0.50</p>
      </ParticipantSegmentBar>,
    )

    const bar = screen.getByTestId('participant-segment-bar')
    const track = bar.querySelector('[aria-hidden="true"].h-4')
    const segments = track?.querySelectorAll('[class~="@container"]')

    expect(segments).toHaveLength(3)
    expect(segments?.[0]).toHaveStyle({ width: '50%' })
    expect(segments?.[1]).toHaveStyle({ width: '30%' })
    expect(segments?.[2]).toHaveStyle({ width: '20%' })
    expect(segments?.[0]).toHaveClass('bg-emerald-500')
    expect(segments?.[1]).toHaveClass('bg-fuchsia-500')
    expect(segments?.[2]).toHaveClass('bg-emerald-500')
    expect(track?.querySelectorAll('[class~="@min-[24px]:flex"]')).toHaveLength(
      3,
    )
    expect(bar).toHaveTextContent('Ada owes Grace €0.50')
  })

  it('keeps a single participant textual and supports disabling avatars', () => {
    const { rerender } = render(
      <ParticipantSegmentBar
        rows={[{ id: 'ada', name: 'Ada', amount: 100 }]}
        currency={EUR}
        locale="en-US"
      >
        <span>Ada is settled</span>
      </ParticipantSegmentBar>,
    )

    const bar = screen.getByTestId('participant-segment-bar')
    expect(bar.querySelector('[aria-hidden="true"].h-4')).toBeNull()
    expect(bar).toHaveTextContent('Ada is settled')

    rerender(
      <ParticipantSegmentBar
        rows={[{ id: 'ada', name: 'Ada', amount: 100 }]}
        currency={EUR}
        locale="en-US"
        showSingleParticipantBar
      />,
    )
    expect(
      screen
        .getByTestId('participant-segment-bar')
        .querySelector('[aria-hidden="true"].h-4'),
    ).toBeInTheDocument()

    rerender(
      <ParticipantSegmentBar
        rows={[
          { id: 'ada', name: 'Ada', amount: 99 },
          { id: 'grace', name: 'Grace', amount: 1 },
        ]}
        currency={EUR}
        locale="en-US"
        showAvatars={false}
      />,
    )
    expect(
      screen
        .getByTestId('participant-segment-bar')
        .querySelectorAll('[class~="@min-[24px]:flex"]'),
    ).toHaveLength(0)
  })

  it('normalizes negative color indexes and prefers an explicit color class', () => {
    expect(participantSegmentColor({ colorIndex: -1 }, 0)).toBe('bg-cyan-500')
    expect(
      participantSegmentColor(
        { colorIndex: 0, colorClass: 'bg-fuchsia-500' },
        2,
      ),
    ).toBe('bg-fuchsia-500')
  })
})
