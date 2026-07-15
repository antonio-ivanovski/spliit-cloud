import {
  Carousel,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'

describe('Carousel', () => {
  it('uses translated accessible labels for navigation controls', () => {
    render(
      <Carousel>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>,
    )

    expect(
      screen.getByRole('button', { name: 'Previous slide' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Next slide' }),
    ).toBeInTheDocument()
  })
})
