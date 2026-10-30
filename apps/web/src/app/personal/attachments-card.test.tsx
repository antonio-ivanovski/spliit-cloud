import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PersonalAttachmentsCard } from '@/app/personal/attachments-card'
import type { PersonalEntry } from '@/app/personal/types'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

const uploadToS3 = vi.fn()
const addMutateAsync = vi.fn()
const removeMutateAsync = vi.fn()
const toast = vi.fn()
const onChanged = vi.fn()

vi.mock('@/lib/upload', () => ({
  resizeImage: vi.fn(async (file: File) => ({
    file,
    width: 100,
    height: 100,
  })),
  useExpenseDocumentUpload: () => ({ uploadToS3: vi.fn() }),
  usePersonalDocumentUpload: () => ({ uploadToS3 }),
}))

vi.mock('@/app/personal/api', () => ({
  useAddPersonalAttachment: () => ({ mutateAsync: addMutateAsync }),
  useRemovePersonalAttachment: () => ({ mutateAsync: removeMutateAsync }),
}))

vi.mock('@/lib/effective-runtime-feature-flags', () => ({
  useEffectiveRuntimeFeatureFlags: () => ({
    flags: { enableExpenseDocuments: true },
    isLoading: false,
  }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}))

function entry(overrides: Partial<PersonalEntry> = {}): PersonalEntry {
  return {
    id: 'entry-1',
    kind: 'EXPENSE',
    amount: 2500,
    currencyCode: 'USD',
    originalAmount: null,
    originalCurrency: null,
    date: '2026-10-20',
    categoryId: 'groceries',
    title: 'Weekly shop',
    note: null,
    version: 1,
    source: 'PERSONAL',
    group: null,
    canEdit: true,
    attachments: [],
    recurring: null,
    ...overrides,
  }
}

beforeEach(() => {
  uploadToS3.mockReset()
  addMutateAsync.mockReset()
  removeMutateAsync.mockReset()
  toast.mockReset()
  onChanged.mockReset()
  uploadToS3.mockResolvedValue({ url: 'https://cdn.test/personal/r1.jpg' })
})

describe('PersonalAttachmentsCard', () => {
  it('renders nothing for shared entries', () => {
    const { container } = render(
      <PersonalAttachmentsCard
        entry={entry({
          source: 'GROUP',
          canEdit: false,
          group: { id: 'g-1', name: 'Group' },
        })}
        canEdit
        onChanged={onChanged}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when editing is disabled', () => {
    const { container } = render(
      <PersonalAttachmentsCard
        entry={entry()}
        canEdit={false}
        onChanged={onChanged}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('uploads a file through presign and persists the server attachment', async () => {
    addMutateAsync.mockResolvedValue({
      id: 'pa-1',
      url: 'https://cdn.test/documents/personal/acct-1/r1.jpg',
      fileName: 'r1.jpg',
      contentType: 'image/jpeg',
      width: 100,
      height: 100,
      createdAt: new Date().toISOString(),
    })
    const { container } = render(
      <PersonalAttachmentsCard entry={entry()} canEdit onChanged={onChanged} />,
    )
    const fileInput =
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    const file = new File(['receipt'], 'r1.jpg', { type: 'image/jpeg' })

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledTimes(1))
    expect(uploadToS3).toHaveBeenCalledTimes(1)
    expect(addMutateAsync).toHaveBeenCalledWith({
      transactionId: 'entry-1',
      expectedVersion: 1,
      attachment: expect.objectContaining({
        url: 'https://cdn.test/personal/r1.jpg',
        fileName: 'r1.jpg',
      }),
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('removes an attachment and reverts with a toast on failure', async () => {
    removeMutateAsync.mockRejectedValueOnce(new Error('gone'))
    render(
      <PersonalAttachmentsCard
        entry={entry({
          attachments: [
            {
              id: 'pa-1',
              url: 'https://cdn.test/documents/personal/acct-1/r1.jpg',
              fileName: 'r1.jpg',
              contentType: 'image/jpeg',
              width: 100,
              height: 100,
              createdAt: new Date().toISOString(),
            },
          ],
        })}
        canEdit
        onChanged={onChanged}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete document/i }))

    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledTimes(1))
    expect(removeMutateAsync).toHaveBeenCalledWith({
      transactionId: 'entry-1',
      attachmentId: 'pa-1',
      expectedVersion: 1,
    })
    await waitFor(() => expect(toast).toHaveBeenCalled())
  })

  it('keeps state and shows a single toast when persistence fails', async () => {
    addMutateAsync.mockRejectedValueOnce(new Error('boom'))
    const { container } = render(
      <PersonalAttachmentsCard entry={entry()} canEdit onChanged={onChanged} />,
    )
    const fileInput =
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    const file = new File(['receipt'], 'r1.jpg', { type: 'image/jpeg' })

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledTimes(1))
    // Exactly one toast: the shared generic error toast (the card no longer
    // toasts validation/persistence failures itself).
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(onChanged).not.toHaveBeenCalled()
    // No thumbnail was added: the empty-state add action is still showing.
    expect(
      screen.getByRole('button', { name: /add attachments/i }),
    ).toBeInTheDocument()
    expect(container.querySelector('[class*="aspect-square"]')).toBeNull()
  })

  it('hides the picker and refuses uploads at the 10-attachment cap', async () => {
    const attachments = Array.from({ length: 10 }, (_, index) => ({
      id: `pa-${index}`,
      url: `https://cdn.test/documents/personal/acct-1/r${index}.jpg`,
      fileName: `r${index}.jpg`,
      contentType: 'image/jpeg',
      width: 100,
      height: 100,
      createdAt: new Date().toISOString(),
    }))
    const { container } = render(
      <PersonalAttachmentsCard
        entry={entry({ attachments })}
        canEdit
        onChanged={onChanged}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /add attachments/i }),
    ).toBeNull()
    expect(screen.getByText(/maximum of 10 receipts/i)).toBeInTheDocument()

    const fileInput =
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['receipt'], 'extra.jpg', { type: 'image/jpeg' })],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(uploadToS3).not.toHaveBeenCalled()
    expect(addMutateAsync).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
