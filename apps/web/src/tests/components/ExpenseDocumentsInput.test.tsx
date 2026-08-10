import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

const uploadToS3 = vi.fn().mockResolvedValue({
  url: 'https://example.com/receipt.pdf',
})
const toast = vi.fn()

vi.mock('@/lib/upload', () => ({
  resizeImage: vi.fn(),
  usePresignedUpload: () => ({
    uploadToS3,
    openFileDialog: vi.fn(),
    FileInput: ({
      inputId = 'file',
      onFilesChange,
      ...props
    }: {
      inputId?: string
      onFilesChange?: (files: File[]) => void
    } & Record<string, unknown>) => (
      <input
        {...props}
        data-testid={`expense-file-input-${inputId}`}
        type="file"
        onChange={(event) =>
          onFilesChange?.(Array.from(event.currentTarget.files ?? []))
        }
      />
    ),
  }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}))

function renderInput({
  readOnly = false,
  updateDocuments = vi.fn(),
}: {
  readOnly?: boolean
  updateDocuments?: (documents: ExpenseFormInputValues['documents']) => void
} = {}) {
  return {
    updateDocuments,
    ...render(
      <form data-expense-form>
        <ExpenseDocumentsInput
          documents={[]}
          updateDocuments={updateDocuments}
          ledgerId="ledger-1"
          readOnly={readOnly}
        />
      </form>,
    ),
  }
}

beforeEach(() => {
  uploadToS3.mockReset()
  uploadToS3.mockResolvedValue({ url: 'https://example.com/receipt.pdf' })
  toast.mockReset()
})

describe('ExpenseDocumentsInput form drag and drop', () => {
  it('accepts a document dropped anywhere on the expense form and prevents navigation', async () => {
    const { updateDocuments } = renderInput()
    const form = screen.getByTestId('expense-file-input-file').closest('form')!
    const file = new File(['receipt'], 'receipt.pdf', {
      type: 'application/pdf',
    })

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'dataTransfer', {
      value: { types: ['Files'] },
    })
    form.dispatchEvent(dragOver)
    expect(dragOver.defaultPrevented).toBe(true)

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await waitFor(() => expect(updateDocuments).toHaveBeenCalledTimes(1))
    expect(uploadToS3).toHaveBeenCalledWith(file)
    expect(updateDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
      }),
    ])
  })

  it('does not attach dropped files in read-only mode', async () => {
    const { updateDocuments } = renderInput({ readOnly: true })
    const form = screen.getByTestId('expense-file-input-file').closest('form')!
    const file = new File(['receipt'], 'receipt.pdf', {
      type: 'application/pdf',
    })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(updateDocuments).not.toHaveBeenCalled()
    expect(uploadToS3).not.toHaveBeenCalled()
  })

  it('ignores a second drop while the first upload is pending', async () => {
    let resolveUpload!: (value: { url: string }) => void
    uploadToS3.mockReturnValueOnce(
      new Promise<{ url: string }>((resolve) => {
        resolveUpload = resolve
      }),
    )
    const { updateDocuments } = renderInput()
    const form = screen.getByTestId('expense-file-input-file').closest('form')!
    const first = new File(['one'], 'one.pdf', { type: 'application/pdf' })
    const second = new File(['two'], 'two.pdf', { type: 'application/pdf' })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [first] },
    })
    await waitFor(() => expect(uploadToS3).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: /choose files/i })).toBeDisabled()
    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [second] },
    })
    expect(uploadToS3).toHaveBeenCalledTimes(1)

    resolveUpload({ url: 'https://example.com/one.pdf' })
    await waitFor(() => expect(updateDocuments).toHaveBeenCalledTimes(1))
  })

  it('uses a camera-oriented input for the mobile capture button', () => {
    renderInput()
    const camera = screen.getByTestId('expense-file-input-camera')
    expect(camera).toHaveAttribute('accept', 'image/*')
    expect(camera).toHaveAttribute('capture', 'environment')
  })
})
