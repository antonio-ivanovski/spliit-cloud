import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { AccountAiPreferences } from './ai-preferences'

const mocks = vi.hoisted(() => ({
  patchPreferences: vi.fn(async () => undefined),
  preferences: {
    defaultCurrencyCode: 'USD',
    timeZone: 'Europe/Skopje',
    locale: 'en-US',
    theme: 'system',
    aiFeaturesEnabled: true,
    aiCategoryExtractEnabled: true,
    aiReceiptScanEnabled: true,
    aiVoiceExpenseEnabled: true,
  },
  deploymentFeatures: {
    enableExpenseDocuments: false,
    enableReceiptExtract: true,
    enableVoiceExpense: true,
    enableCategoryExtract: true,
    enableBulkCategorize: false,
    defaultCurrencyCode: 'USD',
    enableGoogleOAuth: false,
    enableGitHubOAuth: false,
  } as
    | {
        enableExpenseDocuments: boolean
        enableReceiptExtract: boolean
        enableVoiceExpense: boolean
        enableCategoryExtract: boolean
        enableBulkCategorize: boolean
        defaultCurrencyCode: string
        enableGoogleOAuth: boolean
        enableGitHubOAuth: boolean
      }
    | undefined,
  setDeploymentFeatures: (
    next:
      | {
          enableExpenseDocuments: boolean
          enableReceiptExtract: boolean
          enableVoiceExpense: boolean
          enableCategoryExtract: boolean
          enableBulkCategorize: boolean
          defaultCurrencyCode: string
          enableGoogleOAuth: boolean
          enableGitHubOAuth: boolean
        }
      | undefined,
  ) => {
    mocks.deploymentFeatures = next
  },
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => mocks.preferences,
  useAccountPreferenceUpdater: () => ({
    ready: true,
    isUpdating: false,
    patchPreferences: mocks.patchPreferences,
  }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    features: {
      get: {
        useQuery: () => ({ data: mocks.deploymentFeatures }),
      },
    },
  },
}))

import '@testing-library/jest-dom/vitest'

describe('AccountAiPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.patchPreferences.mockClear()
    mocks.setDeploymentFeatures({
      enableExpenseDocuments: false,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      defaultCurrencyCode: 'USD',
      enableGoogleOAuth: false,
      enableGitHubOAuth: false,
    })
    mocks.preferences = {
      defaultCurrencyCode: 'USD',
      timeZone: 'Europe/Skopje',
      locale: 'en-US',
      theme: 'system',
      aiFeaturesEnabled: true,
      aiCategoryExtractEnabled: true,
      aiReceiptScanEnabled: true,
      aiVoiceExpenseEnabled: true,
    }
  })

  it('renders switches for every AI surface available on this deployment', () => {
    render(<AccountAiPreferences />)

    expect(
      screen.getByRole('switch', { name: 'Expense categorizer' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Receipt scan' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Voice expense' }),
    ).toBeInTheDocument()
  })

  it('hides rows whose deployment flag is off', () => {
    mocks.setDeploymentFeatures({
      enableExpenseDocuments: false,
      enableReceiptExtract: false,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      defaultCurrencyCode: 'USD',
      enableGoogleOAuth: false,
      enableGitHubOAuth: false,
    })

    render(<AccountAiPreferences />)

    expect(
      screen.getByRole('switch', { name: 'Expense categorizer' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Receipt scan' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Voice expense' }),
    ).toBeInTheDocument()
  })

  it('patches the matching pref when a switch toggles', async () => {
    const { user } = render(<AccountAiPreferences />)
    const receiptSwitch = screen.getByRole('switch', { name: 'Receipt scan' })
    expect(receiptSwitch).toHaveAttribute('data-checked', '')

    await user.click(receiptSwitch)

    expect(mocks.patchPreferences).toHaveBeenCalledWith({
      aiReceiptScanEnabled: false,
    })
  })

  it('patches only the master switch and keeps child preferences intact', async () => {
    const { user } = render(<AccountAiPreferences />)
    const masterSwitch = screen.getByRole('switch', {
      name: 'Enable AI features',
    })
    expect(masterSwitch.closest('header')).not.toBeNull()

    await user.click(masterSwitch)

    expect(mocks.patchPreferences).toHaveBeenCalledWith({
      aiFeaturesEnabled: false,
    })
    expect(mocks.patchPreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({
        aiCategoryExtractEnabled: expect.anything(),
        aiReceiptScanEnabled: expect.anything(),
        aiVoiceExpenseEnabled: expect.anything(),
      }),
    )
  })

  it('hides child preferences while the master switch is off', () => {
    mocks.preferences = {
      ...mocks.preferences,
      aiFeaturesEnabled: false,
    }

    render(<AccountAiPreferences />)

    expect(
      screen.getByRole('switch', { name: 'Enable AI features' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Expense categorizer' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Receipt scan' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Voice expense' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('restores the saved child states when AI is enabled again', () => {
    mocks.preferences = {
      ...mocks.preferences,
      aiFeaturesEnabled: false,
      aiCategoryExtractEnabled: false,
    }
    const { rerender } = render(<AccountAiPreferences />)

    mocks.preferences = {
      ...mocks.preferences,
      aiFeaturesEnabled: true,
    }
    rerender(<AccountAiPreferences />)

    const categorizer = screen.getByRole('switch', {
      name: 'Expense categorizer',
    })
    expect(categorizer.getAttribute('data-unchecked')).not.toBeNull()
  })

  it('shows coming-soon badges for voice language and custom instructions', () => {
    render(<AccountAiPreferences />)

    // Three future-feature rows (voice language, receipt prompts, voice prompts),
    // each with a single neutral "Coming soon" badge and no interactive control.
    const futureRows = [
      'Preferred voice language',
      'Custom instructions for receipt scan',
      'Custom instructions for voice expense',
    ]
    for (const label of futureRows) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('Coming soon')).toHaveLength(3)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('hides coming-soon rows that depend on a disabled server flag', () => {
    mocks.setDeploymentFeatures({
      enableExpenseDocuments: false,
      enableReceiptExtract: false,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      defaultCurrencyCode: 'USD',
      enableGoogleOAuth: false,
      enableGitHubOAuth: false,
    })

    render(<AccountAiPreferences />)

    expect(screen.getByText('Preferred voice language')).toBeInTheDocument()
    expect(
      screen.queryByText('Custom instructions for receipt scan'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Custom instructions for voice expense'),
    ).toBeInTheDocument()
  })

  it('renders nothing if every AI flag is off on the deployment', () => {
    mocks.setDeploymentFeatures({
      enableExpenseDocuments: false,
      enableReceiptExtract: false,
      enableVoiceExpense: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
      defaultCurrencyCode: 'USD',
      enableGoogleOAuth: false,
      enableGitHubOAuth: false,
    })

    const { container } = render(<AccountAiPreferences />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reflects a user-opted-out preference as an unchecked switch', () => {
    mocks.preferences = {
      defaultCurrencyCode: 'USD',
      timeZone: 'Europe/Skopje',
      locale: 'en-US',
      theme: 'system',
      aiFeaturesEnabled: true,
      aiCategoryExtractEnabled: false,
      aiReceiptScanEnabled: true,
      aiVoiceExpenseEnabled: true,
    }

    render(<AccountAiPreferences />)
    const categorizer = screen.getByRole('switch', {
      name: 'Expense categorizer',
    })
    // When the user has opted out, the switch must show the unchecked
    // data state so the badge reflects the saved choice.
    expect(categorizer.getAttribute('data-checked')).toBeNull()
    expect(categorizer.getAttribute('data-unchecked')).not.toBeNull()
  })
})
