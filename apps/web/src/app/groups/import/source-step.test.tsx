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
}))

// SourceStep uses `useRouter` only for tab switching, which the
// prefill-error tests don't exercise.
vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

// `useImportSource` always returns empty data so the inline error
// test isolates the prefill-error prop path.
vi.mock('./use-import-source', () => ({
  useImportSource: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    submit: vi.fn(),
    reset: vi.fn(),
  }),
}))

// ── Tests ───────────────────────────────────────────────────────────────

describe('SourceStep — initialError (prefill) handling', () => {
  it('renders the prefill error inline when no own serverUrlError is set', () => {
    render(
      <SourceStep
        onLoaded={vi.fn()}
        onError={vi.fn()}
        initialError="Spliit did not find this group"
      />,
    )
    expect(
      screen.getByText('Spliit did not find this group'),
    ).toBeInTheDocument()
  })

  it('hides the prefill error after the user types in the URL input', async () => {
    const user = userEvent.setup()
    render(
      <SourceStep
        onLoaded={vi.fn()}
        onError={vi.fn()}
        initialError="Spliit did not find this group"
      />,
    )

    const urlInput = screen.getByPlaceholderText(/spliit\.app.*groups/i)
    await user.type(urlInput, 'a')

    expect(
      screen.queryByText('Spliit did not find this group'),
    ).not.toBeInTheDocument()
  })

  it('does not render any error when no initialError is provided', () => {
    render(<SourceStep onLoaded={vi.fn()} onError={vi.fn()} />)
    // No Spliit error visible.
    expect(
      screen.queryByText(/did not find this group/i),
    ).not.toBeInTheDocument()
  })
})
