import type * as TanStackReactRouter from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

import { useCurrentGroupOrNull } from '@/app/groups/[groupId]/current-group-context'
import { CurrencySwapPage } from '@/app/groups/[groupId]/tools/swap/swap-page'
import type * as HooksModule from '@/lib/hooks'
import { render, screen } from '@/test/test-utils'

const searchState = vi.hoisted(() => ({ target: undefined as unknown }))

const previewState = vi.hoisted(() => ({
  pages: null as null | Array<Record<string, unknown>>,
}))

const executeResult = vi.hoisted(() => ({
  updated: 2,
  newCode: 'EUR',
  seriesTemplatesConverted: 0,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof TanStackReactRouter>()
  return {
    ...original,
    getRouteApi: () => ({
      useSearch: () => ({ target: searchState.target }),
    }),
    Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  }
})

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroupOrNull: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ groups: { invalidate: vi.fn() } }),
    groups: {
      swapPairs: {
        useQuery: () => ({
          data: {
            pairs: [
              {
                base: 'USD',
                target: 'EUR',
                dates: ['2026-10-09'],
                expenseCount: 2,
              },
            ],
            expenseCount: 2,
          },
          isLoading: false,
          isSuccess: true,
          error: null,
        }),
      },
      swapPreview: {
        useInfiniteQuery: () => ({
          data: previewState.pages
            ? { pages: previewState.pages, pageParams: [0] }
            : undefined,
          isLoading: false,
          isFetching: false,
          error: null,
          hasNextPage: false,
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          fetchNextPageError: null,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        }),
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      swapExecute: {
        useMutation: () => ({
          mutateAsync: vi.fn(async () => ({ ...executeResult })),
          isPending: false,
          error: null,
        }),
      },
    },
  },
}))

vi.mock('@/lib/currency', () => ({
  useCurrencies: () => [
    {
      code: 'USD',
      symbol: '$',
      rounding: 0,
      decimal_digits: 2,
      name: 'US Dollar',
    },
    { code: 'EUR', symbol: '€', rounding: 0, decimal_digits: 2, name: 'Euro' },
  ],
}))

vi.mock('@/lib/hooks', async (importOriginal) => {
  const original = await importOriginal<typeof HooksModule>()
  return {
    ...original,
    useCurrencyRates: () => ({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
  }
})

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => null,
  useAccountPreferenceUpdater: () => null,
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => ({ defaultCurrencyCode: 'USD' }),
}))

vi.mock('@/lib/use-online-status', () => ({
  useOnlineStatus: () => true,
}))

function setupGroup() {
  vi.mocked(useCurrentGroupOrNull).mockReturnValue({
    groupId: 'group-1',
    group: {
      id: 'group-1',
      currencyCode: 'USD',
      archived: false,
    } as never,
    currentMember: { role: 'ADMIN' },
    displayName: 'Trip',
  } as never)
}

describe('CurrencySwapPage settings entry', () => {
  it('preselects the settings-handoff target and explains why the tool is required', async () => {
    searchState.target = 'EUR'
    setupGroup()
    render(<CurrencySwapPage />)

    expect(
      await screen.findByText('Continuing from group settings'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /You picked EUR \(Euro\) as the new settlement currency/,
      ),
    ).toBeInTheDocument()
    // The handoff target is preselected in the step-1 picker.
    expect(
      screen.getByRole('combobox', { name: 'New settlement currency' }),
    ).toHaveTextContent('Euro (EUR)')
    expect(
      screen.getByText(/New expenses will default to EUR\./),
    ).toBeInTheDocument()

    searchState.target = undefined
  })

  it('ignores a handoff target that matches the current ledger currency', async () => {
    searchState.target = 'USD'
    setupGroup()
    render(<CurrencySwapPage />)

    expect(
      screen.queryByText('Continuing from group settings'),
    ).not.toBeInTheDocument()
    // Falls back to the default currency (USD == ledger), so nothing is
    // preselected: no target hint, and the picker stays on an empty value.
    // (The trigger renders the head of the non-ledger list as a visual
    // placeholder, which is pre-existing selector behavior.)
    expect(
      screen.queryByText(/New expenses will default to/),
    ).not.toBeInTheDocument()

    searchState.target = undefined
  })
})

describe('CurrencySwapPage access', () => {
  it('shows an admin-only notice to members instead of the wizard', async () => {
    searchState.target = undefined
    vi.mocked(useCurrentGroupOrNull).mockReturnValue({
      groupId: 'group-1',
      group: {
        id: 'group-1',
        currencyCode: 'USD',
        archived: false,
      } as never,
      currentMember: { role: 'MEMBER' },
      displayName: 'Trip',
    } as never)
    render(<CurrencySwapPage />)

    expect(
      await screen.findByText(
        'Only admins can swap the group currency — ask an admin to run it from Tools.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'New settlement currency' }),
    ).not.toBeInTheDocument()
  })
})

describe('CurrencySwapPage review', () => {
  const previewPage = {
    oldCode: 'USD',
    newCode: 'EUR',
    expenseCount: 2,
    truncated: false,
    rows: [
      {
        id: 'row-1',
        expenseId: 'e1',
        title: 'Clean expense',
        expenseDate: '2026-10-09',
        kind: 'simple',
        oldAmount: 1000,
        newAmount: 900,
        newOriginalAmount: null,
        newOriginalCurrency: null,
        newConversionRate: null,
        newConversionSource: null,
        rateUsed: 0.9,
        rateDate: '2026-10-09',
      },
      {
        id: 'row-2',
        expenseId: 'e2',
        title: 'Exact fee',
        expenseDate: '2026-10-09',
        kind: 'bridged',
        oldAmount: 1200,
        newAmount: 1100,
        newOriginalAmount: 1200,
        newOriginalCurrency: 'USD',
        newConversionRate: 0.92,
        newConversionSource: 'CUSTOM',
        rateUsed: 0.92,
        rateDate: '2026-10-09',
        warning: 'exact-to-custom',
      },
    ],
    missingRateCount: 0,
    sumOld: 2200,
    sumNew: 2000,
    budgetCount: 0,
    activeRecurringCount: 0,
    seriesTemplateCount: 0,
    warnings: [],
  }

  it('shows only attention rows inline and the full list in a dialog', async () => {
    searchState.target = 'EUR'
    setupGroup()
    previewState.pages = [previewPage]
    const { user } = render(<CurrencySwapPage />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Preview conversion' }))

    // Attention-only inline: the warning row renders, the clean row does not.
    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('Exact fee')).toBeInTheDocument()
    expect(screen.queryByText('Clean expense')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'View all 2 expenses' }),
    )
    await screen.findByRole('dialog')
    expect(screen.getByText('Clean expense')).toBeInTheDocument()
    expect(screen.getAllByText('Exact fee')).toHaveLength(2)
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument()

    searchState.target = undefined
    previewState.pages = null
  })

  it('hides the attention heading when nothing needs attention', async () => {
    searchState.target = 'EUR'
    setupGroup()
    previewState.pages = [
      {
        ...previewPage,
        rows: previewPage.rows.map(({ warning: _warning, ...row }) => row),
      },
    ]
    const { user } = render(<CurrencySwapPage />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Preview conversion' }))

    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(screen.getByText('No expenses need attention.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'View all 2 expenses' }),
    ).toBeInTheDocument()

    searchState.target = undefined
    previewState.pages = null
  })

  it('lists fixed-fallback rows under attention without blocking', async () => {
    searchState.target = 'EUR'
    setupGroup()
    previewState.pages = [
      {
        ...previewPage,
        rows: [
          previewPage.rows[0],
          {
            ...previewPage.rows[0],
            id: 'row-3',
            expenseId: 'e3',
            title: 'Sofia dinner',
            warning: 'fixed-fallback',
          },
        ],
        warnings: ['fixed-fallback'],
      },
    ]
    const { user } = render(<CurrencySwapPage />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Preview conversion' }))

    // Warn-only: the fallback row needs attention but blocks nothing.
    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('Sofia dinner')).toBeInTheDocument()
    expect(screen.queryByText('Clean expense')).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/fixed conversion/).length,
    ).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/block the swap/)).not.toBeInTheDocument()

    searchState.target = undefined
    previewState.pages = null
  })

  it('promises template conversion and reports converted templates', async () => {
    searchState.target = 'EUR'
    setupGroup()
    previewState.pages = [
      {
        ...previewPage,
        seriesTemplateCount: 2,
        warnings: ['series-templates-convert'],
      },
    ]
    executeResult.seriesTemplatesConverted = 2
    const { user } = render(<CurrencySwapPage />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Preview conversion' }))

    expect(
      await screen.findByText(/2 recurring templates will convert/i),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Continue to confirm' }),
    )
    await user.click(screen.getByRole('button', { name: /swap 2 expenses/i }))
    expect(
      await screen.findByText(/2 recurring templates also converted/i),
    ).toBeInTheDocument()

    searchState.target = undefined
    previewState.pages = null
    executeResult.seriesTemplatesConverted = 0
  })
})
