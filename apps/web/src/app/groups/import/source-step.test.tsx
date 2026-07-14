import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SourceStep } from './source-step'

// jsdom doesn't implement scrollIntoView; the SourceStep mount effect
// calls it on the active tab.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {}
  }
})

// ── Module mocks ────────────────────────────────────────────────────────

// Mock @tanstack/react-router so we don't need to spin up a router.
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({ source: 'spliit' as const }),
  }),
  Link: ({
    to,
    children,
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

// SourceStep no longer owns its own useImportSource; the wizard passes
// the shared state down. The tests pass it explicitly so the prefill-
// error path is the only thing under test.
function renderSourceStep(
  overrides: Partial<React.ComponentProps<typeof SourceStep>> = {},
) {
  return render(
    <SourceStep
      onLoaded={vi.fn()}
      onError={vi.fn()}
      sourcePreview={undefined}
      isSourcePreviewLoading={false}
      sourcePreviewError={null}
      submitPreview={vi.fn()}
      resetPreview={vi.fn()}
      {...overrides}
    />,
  )
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('SourceStep — initialError (prefill) handling', () => {
  it('renders the prefill error inline when no own serverUrlError is set', () => {
    renderSourceStep({
      initialError: 'Spliit Cloud did not find this group',
    })
    expect(
      screen.getByText('Spliit Cloud did not find this group'),
    ).toBeInTheDocument()
  })

  it('hides the prefill error after the user types in the URL input', async () => {
    const user = userEvent.setup()
    renderSourceStep({
      initialError: 'Spliit Cloud did not find this group',
    })

    const urlInput = screen.getByPlaceholderText(/spliit\.app.*groups/i)
    await user.type(urlInput, 'a')

    expect(
      screen.queryByText('Spliit Cloud did not find this group'),
    ).not.toBeInTheDocument()
  })

  it('does not render any error when no initialError is provided', () => {
    renderSourceStep()
    // No Spliit error visible.
    expect(
      screen.queryByText(/did not find this group/i),
    ).not.toBeInTheDocument()
  })
})
