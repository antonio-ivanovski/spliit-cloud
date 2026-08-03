import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useCurrentGroup,
  useCurrentGroupOrNull,
} from '@/app/groups/[groupId]/current-group-context'
import { ReceiptScanTrigger } from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import { act, render, screen, waitFor } from '@/test/test-utils'

const mockMutateAsync = vi.fn()
const mockToast = vi.fn()

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
  useCurrentGroupOrNull: vi.fn(),
  useIsPendingInvitee: vi.fn().mockReturnValue(false),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    ai: {
      extractExpenseInformationFromImage: {
        useMutation: () => ({ mutateAsync: mockMutateAsync }),
      },
    },
  },
}))

vi.mock('@/lib/upload', () => ({
  resizeImage: vi.fn(),
  usePresignedUpload: () => ({
    uploadToS3: vi.fn(),
    FileInput: () => null,
    openFileDialog: vi.fn(),
  }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({}),
}))

const group = {
  id: 'group-1',
  name: 'Trip',
  currency: '$',
  currencyCode: 'USD',
  ledgerId: 'ledger-1',
}

const documents = [
  {
    id: 'doc-1',
    url: 'https://example.com/receipt.jpg',
    width: 800,
    height: 600,
  },
]

const scanResult = {
  amount: 1000,
  categoryId: 'groceries',
  currencyCode: 'USD',
  date: '2025-01-01',
  title: 'Test Store',
  items: [],
}

function renderTrigger(
  props: Partial<React.ComponentProps<typeof ReceiptScanTrigger>> = {},
) {
  return render(
    <ReceiptScanTrigger documents={documents} autoScan {...props} />,
  )
}

beforeEach(() => {
  vi.mocked(useCurrentGroup).mockReturnValue({
    group,
    isLoading: false,
  } as never)
  vi.mocked(useCurrentGroupOrNull).mockReturnValue({
    group,
    groupId: group.id,
    isLoading: false,
  } as never)
  mockMutateAsync.mockReset()
  mockMutateAsync.mockResolvedValue(scanResult)
  mockToast.mockReset()
  localStorage.clear()
})

async function openDialog() {
  const result = renderTrigger()
  const trigger = screen.getByRole('button', { name: /ai receipt scan/i })
  await result.user.click(trigger)
  return result
}

async function waitForSettledCheckbox() {
  const checkbox = await screen.findByRole('checkbox', { name: /translate/i })
  await waitFor(() => {
    expect(checkbox).toBeEnabled()
  })
  return checkbox
}

describe('ReceiptScanTrigger translate checkbox', () => {
  it('is unchecked by default and sends translateToLocale: false', async () => {
    await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    expect(mockMutateAsync.mock.calls[0][0].translateToLocale).toBe(false)

    const checkbox = await waitForSettledCheckbox()
    expect(checkbox).not.toBeChecked()
  })

  it('reads stored "true" and sends translateToLocale: true on auto-scan', async () => {
    localStorage.setItem('spliit-receipt-translate-to-locale', 'true')

    await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    expect(mockMutateAsync.mock.calls[0][0].translateToLocale).toBe(true)

    const checkbox = await waitForSettledCheckbox()
    expect(checkbox).toBeChecked()
  })

  it('persists the checkbox value to localStorage on toggle', async () => {
    const { user } = await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    const checkbox = await waitForSettledCheckbox()
    await user.click(checkbox)

    expect(localStorage.getItem('spliit-receipt-translate-to-locale')).toBe(
      'true',
    )
  })

  it('rescans with the new value when toggled after a completed scan', async () => {
    const { user } = await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    const checkbox = await waitForSettledCheckbox()
    await user.click(checkbox)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    })

    expect(mockMutateAsync.mock.calls[1][0].translateToLocale).toBe(true)
    expect(mockMutateAsync.mock.calls[1][0].imageUrl).toBe(documents[0].url)
  })

  it('is disabled while a scan is pending', async () => {
    let resolveScan: (value: unknown) => void
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve
        }),
    )

    await openDialog()

    const checkbox = await screen.findByRole('checkbox', { name: /translate/i })
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')

    await act(async () => {
      resolveScan!(scanResult)
    })

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: /translate/i }),
      ).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('does not break when localStorage.getItem throws', async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation((key) => {
        if (key === 'spliit-receipt-translate-to-locale') {
          throw new Error('storage unavailable')
        }
        return null
      })

    await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    expect(mockMutateAsync.mock.calls[0][0].translateToLocale).toBe(false)
    const checkbox = await waitForSettledCheckbox()
    expect(checkbox).not.toBeChecked()

    getItemSpy.mockRestore()
  })

  it('does not break when localStorage.setItem throws on toggle', async () => {
    const { user } = await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable')
      })

    const checkbox = await waitForSettledCheckbox()
    await user.click(checkbox)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    })

    setItemSpy.mockRestore()
  })

  it('does not auto-rescan when toggling after a failed scan; Retry sends latest translation', async () => {
    let rejectScan: (err: unknown) => void
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectScan = reject
        }),
    )
    mockMutateAsync.mockResolvedValue(scanResult)

    const { user } = await openDialog()

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    // Fail the first scan → selectedDocument is set, receiptInfo stays null,
    // and a destructive Retry toast is registered.
    await act(async () => {
      rejectScan!(new Error('AI service unavailable'))
    })

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled()
    })

    const toastCall = mockToast.mock.calls.at(-1)!
    const retryAction = toastCall[0].action as React.ReactElement<{
      onClick: () => void
    }>

    expect(retryAction).toBeTruthy()
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)

    // Toggling the checkbox after a failed scan must NOT trigger another request.
    const checkbox = await waitForSettledCheckbox()
    await user.click(checkbox)

    // Give any rogue effect a chance to fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)

    // Invoking the Retry action must send the latest translateToLocale value.
    act(() => {
      retryAction.props.onClick()
    })

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
      expect(checkbox).toBeEnabled()
    })

    expect(mockMutateAsync.mock.calls[1][0].translateToLocale).toBe(true)
    expect(mockMutateAsync.mock.calls[1][0].imageUrl).toBe(documents[0].url)
  })
})
