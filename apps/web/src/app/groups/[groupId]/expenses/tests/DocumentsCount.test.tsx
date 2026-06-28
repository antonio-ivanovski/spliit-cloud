import { render, screen } from '@/test/test-utils'
import { DocumentsCount } from '@/app/groups/[groupId]/expenses/documents-count'

describe('DocumentsCount', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<DocumentsCount count={0} />)
    // React Fragment <></> renders with no DOM node
    expect(container.firstChild).toBeNull()
  })

  it('renders paperclip icon and count when count is greater than 0', () => {
    const { container } = render(<DocumentsCount count={5} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(container.querySelector('.lucide-paperclip')).toBeInTheDocument()
  })
})
