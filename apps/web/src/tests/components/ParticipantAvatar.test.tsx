import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ParticipantAvatar } from '@/components/participant-avatar'

describe('ParticipantAvatar', () => {
  it('shows initials with an opaque background for an unlinked participant', () => {
    render(
      <ParticipantAvatar
        participant={{ id: 'participant-1', name: 'Ada Lovelace' }}
        size="md"
      />,
    )

    const fallback = screen.getByText('AL')
    expect(fallback).toHaveClass('bg-primary/15')
    expect(fallback.parentElement).toHaveClass('text-xs')
  })

  it('uses the linked account image when one is available', () => {
    const { container } = render(
      <ParticipantAvatar
        participant={{
          id: 'participant-1',
          name: 'Ada Lovelace',
          account: {
            id: 'account-1',
            name: 'Ada Lovelace',
            image: 'https://example.com/avatar.jpg',
          },
        }}
      />,
    )

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/avatar.jpg',
    )
  })
})
