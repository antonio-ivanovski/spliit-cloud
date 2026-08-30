import { describe, expect, it } from 'vitest'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { render, screen } from '@/test/test-utils'

describe('Card responsive spacing', () => {
  it('keeps the default card rounded and uses compact mobile padding', () => {
    render(
      <Card data-testid="card">
        <CardHeader data-testid="header" />
        <CardContent data-testid="content">Content</CardContent>
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass('rounded-lg')
    expect(screen.getByTestId('header')).toHaveClass('p-4', 'sm:p-6')
    expect(screen.getByTestId('content')).toHaveClass(
      'px-4',
      'pb-4',
      'pt-0',
      'sm:px-6',
      'sm:pb-6',
    )
  })

  it('adds top breathing room for standalone content', () => {
    render(
      <Card>
        <CardContent spacing="standalone">Standalone</CardContent>
      </Card>,
    )

    expect(screen.getByText('Standalone')).toHaveClass(
      'pt-4',
      'sm:pt-6',
    )
  })
})
