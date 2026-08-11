import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

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
      index: { sourceId: 'group-1', displayName: 'Trip', archived: false },
      inspection: {
        manifest: { complete: true, warnings: [] },
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
})
