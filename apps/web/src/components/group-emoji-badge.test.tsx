import { describe, expect, it } from 'vitest'

import { GroupEmojiBadge } from '@/components/group-emoji-badge'
import { render } from '@/test/test-utils'

describe('GroupEmojiBadge', () => {
  it('renders the emoji with the matching color chip', () => {
    const { container } = render(<GroupEmojiBadge emoji="🎉" color="teal" />)
    const badge = container.querySelector('[data-group-emoji]')
    expect(badge).not.toBeNull()
    expect(badge).toHaveTextContent('🎉')
    expect(badge?.className).toContain('group-accent-chip')
    expect(
      (badge as HTMLElement).style.getPropertyValue('--group-accent'),
    ).toBe('#14b8a6')
  })

  it('supports custom hex colors', () => {
    const { container } = render(<GroupEmojiBadge emoji="🎉" color="#a1b2c3" />)
    const badge = container.querySelector('[data-group-emoji]')
    expect(badge?.className).toContain('group-accent-chip')
    expect(
      (badge as HTMLElement).style.getPropertyValue('--group-accent'),
    ).toBe('#a1b2c3')
  })

  it('falls back to the neutral chip when the color is missing or unknown', () => {
    const { container } = render(
      <GroupEmojiBadge emoji="🎉" color="chartreuse" />,
    )
    const badge = container.querySelector('[data-group-emoji]')
    expect(badge?.className).toContain('bg-muted')
  })

  it('renders nothing for the undecided and declined states', () => {
    const { container } = render(<GroupEmojiBadge emoji={null} color="teal" />)
    expect(container.querySelector('[data-group-emoji]')).toBeNull()

    const declined = render(<GroupEmojiBadge emoji="" color="teal" />)
    expect(declined.container.querySelector('[data-group-emoji]')).toBeNull()

    const missing = render(<GroupEmojiBadge emoji={undefined} color={null} />)
    expect(missing.container.querySelector('[data-group-emoji]')).toBeNull()
  })

  it('renders a color-only swatch when asked and no emoji is set', () => {
    const { container } = render(
      <GroupEmojiBadge emoji={null} color="teal" showColorOnly />,
    )
    const badge = container.querySelector('[data-group-emoji]')
    expect(badge).not.toBeNull()
    expect(badge).toHaveTextContent('')
    expect(badge?.className).toContain('group-accent-chip')

    const noColor = render(
      <GroupEmojiBadge emoji={null} color={null} showColorOnly />,
    )
    expect(noColor.container.querySelector('[data-group-emoji]')).toBeNull()
  })
})
