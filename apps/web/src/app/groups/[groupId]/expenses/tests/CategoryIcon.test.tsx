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
        className="h-5 w-5"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('lucide-clapperboard')
    expect(svg).toHaveClass('w-5 h-5')
  })

  it('renders the Wallet icon for Income', () => {
    const { container } = render(
      <CategoryIcon category={{ grouping: 'Income', name: 'Income' }} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('lucide-wallet')
  })

  it('renders distinct icons for parent categories and corrected mappings', () => {
    const cases = [
      {
        grouping: 'Uncategorized',
        name: 'Uncategorized',
        className: 'lucide-shapes',
      },
      { grouping: 'Utilities', name: 'Utilities', className: 'lucide-zap' },
      { grouping: 'Utilities', name: 'Water', className: 'lucide-droplets' },
      {
        grouping: 'Food and Drink',
        name: 'Dining Out',
        className: 'lucide-utensils-crossed',
      },
    ] as const

    for (const category of cases) {
      const { container, unmount } = render(
        <CategoryIcon category={category} />,
      )
      expect(container.querySelector('svg')).toHaveClass(category.className)
      unmount()
    }
  })
})
