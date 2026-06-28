import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { render } from '@/test/test-utils'

describe('CategoryIcon', () => {
  it('renders the correct icon for a known category', () => {
    const { container } = render(
      <CategoryIcon
        category={{ grouping: 'Food and Drink', name: 'Groceries' }}
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('lucide-shopping-cart')
  })

  it('renders the default Banknote icon for an unknown category', () => {
    const { container } = render(
      <CategoryIcon category={{ grouping: 'Unknown', name: 'Something' }} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('lucide-banknote')
  })

  it('renders the default Banknote icon when category is null', () => {
    const { container } = render(<CategoryIcon category={null} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('lucide-banknote')
  })

  it('passes additional props and className to the SVG element', () => {
    const { container } = render(
      <CategoryIcon
        category={{ grouping: 'Entertainment', name: 'Movies' }}
        className="w-5 h-5"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('lucide-clapperboard')
    expect(svg).toHaveClass('w-5 h-5')
  })
})
