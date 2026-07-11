import { AvatarStack } from '@/components/avatar-stack'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('AvatarStack', () => {
  it('keeps fallback avatars opaque when they overlap', () => {
    render(
      <AvatarStack
        accounts={[
          { id: 'account-1', name: 'Ada Lovelace' },
          { id: 'account-2', name: 'Grace Hopper' },
        ]}
        label="2 members"
      />,
    )

    expect(screen.getByText('AL').parentElement).toHaveClass('bg-background')
    expect(screen.getByText('GH').parentElement).toHaveClass('bg-background')
  })
})
