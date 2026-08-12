import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen, within } from '@/test/test-utils'

import { AccountImportSetup } from './account-import-setup'
import type { CloudAccountBundleInspection } from './cloud-bundle'

const bundle = {
  kind: 'ACCOUNT',
  manifest: {
    complete: true,
    warnings: [],
    contents: {
      documents: true,
      accountPreferences: true,
      groupPreferences: true,
    },
    account: {
      name: 'Alice',
      email: 'alice@example.com',
      preferences: { defaultCurrencyCode: 'EUR' },
      notificationPreferences: [],
    },
    groupPreferences: [],
  },
  groups: [
    {
      index: {
        sourceId: 'group-1',
        displayName: 'Trip',
        groupType: 'GROUP',
        archived: false,
      },
      inspection: {
        manifest: {
          complete: true,
          warnings: [],
          group: { ledger: { currency: '€', currencyCode: 'EUR' } },
          participants: [{ sourceId: 'person-1' }, { sourceId: 'person-2' }],
          expenses: [{ documents: [] }],
          orphanDocuments: [],
        },
        documentIssues: [],
      },
    },
  ],
} as unknown as CloudAccountBundleInspection

describe('AccountImportSetup', () => {
  it('allows selecting groups and starting the sequential import', async () => {
    const user = userEvent.setup()
    const onToggleGroup = vi.fn()
    const onContinue = vi.fn()

    render(
      <AccountImportSetup
        bundle={bundle}
        selectedGroupIds={new Set(['group-1'])}
        includeAccountPreferences
        includeGroupPreferences
        isApplying={false}
        error={null}
        onToggleGroup={onToggleGroup}
        onToggleAccountPreferences={vi.fn()}
        onToggleGroupPreferences={vi.fn()}
        onContinue={onContinue}
      />,
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Trip/ })).toBeChecked()
    expect(screen.getAllByRole('switch')).toHaveLength(2)

    await user.click(
      screen.getByRole('button', { name: 'Continue to group imports' }),
    )
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('groups bundle ledgers like the home page and describes their contents', () => {
    const groupedBundle = {
      ...bundle,
      manifest: {
        ...bundle.manifest,
        groupPreferences: [
          {
            groupSourceId: 'starred-1',
            starred: true,
            hidden: false,
            defaultSplit: null,
          },
        ],
      },
      groups: [
        ...bundle.groups,
        {
          index: {
            sourceId: 'friend-1',
            displayName: 'Robin',
            groupType: 'FRIEND',
            archived: false,
          },
          inspection: {
            manifest: {
              complete: true,
              warnings: [],
              group: { ledger: { currency: '$', currencyCode: 'USD' } },
              participants: [{ sourceId: 'me' }, { sourceId: 'robin' }],
              expenses: [],
              orphanDocuments: [],
            },
            documentIssues: [],
          },
        },
        {
          index: {
            sourceId: 'archived-1',
            displayName: 'Old flat',
            groupType: 'GROUP',
            archived: true,
          },
          inspection: {
            manifest: {
              complete: true,
              warnings: [],
              group: { ledger: { currency: '£', currencyCode: 'GBP' } },
              participants: [{ sourceId: 'me' }],
              expenses: [],
              orphanDocuments: [],
            },
            documentIssues: [],
          },
        },
        {
          index: {
            sourceId: 'starred-1',
            displayName: 'Favorites trip',
            groupType: 'GROUP',
            archived: false,
          },
          inspection: {
            manifest: {
              complete: true,
              warnings: [],
              group: { ledger: { currency: '€', currencyCode: 'EUR' } },
              participants: [{ sourceId: 'me' }],
              expenses: [],
              orphanDocuments: [],
            },
            documentIssues: [],
          },
        },
      ],
    } as unknown as CloudAccountBundleInspection

    render(
      <AccountImportSetup
        bundle={groupedBundle}
        selectedGroupIds={
          new Set(groupedBundle.groups.map(({ index }) => index.sourceId))
        }
        includeAccountPreferences
        includeGroupPreferences
        isApplying={false}
        error={null}
        onToggleGroup={vi.fn()}
        onToggleAccountPreferences={vi.fn()}
        onToggleGroupPreferences={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Groups' })).toHaveTextContent(
      'Trip',
    )
    const friendsSection = screen.getByRole('group', { name: 'Friends' })
    expect(friendsSection).toHaveTextContent('Robin')
    expect(screen.getByRole('group', { name: 'Archived' })).toHaveTextContent(
      'Old flat',
    )
    expect(screen.getByRole('group', { name: 'Starred' })).toHaveTextContent(
      'Favorites trip',
    )
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(
      within(friendsSection).getByLabelText(
        '2 participant(s) will be restored',
      ),
    ).toBeInTheDocument()
  })
})
