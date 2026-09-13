import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import { useMediaQuery } from '@/lib/hooks'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

const uploadToS3 = vi.fn().mockResolvedValue({
  url: 'https://example.com/receipt.pdf',
})
const toast = vi.fn()
const mediaQueryMock = vi.mocked(useMediaQuery)

vi.mock('@/lib/upload', () => ({
  resizeImage: vi.fn(),
  useExpenseDocumentUpload: () => ({
    uploadToS3,
  }),
}))

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: vi.fn(() => false),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}))

function renderInput({
  readOnly = false,
  updateDocuments = vi.fn(),
  documents = [],
}: {
  readOnly?: boolean
  updateDocuments?: (documents: ExpenseFormInputValues['documents']) => void
  documents?: ExpenseFormInputValues['documents']
} = {}) {
  return {
    updateDocuments,
    ...render(
      <form data-expense-form>
        <ExpenseDocumentsInput
          documents={documents}
          updateDocuments={updateDocuments}
          ledgerId="ledger-1"
          readOnly={readOnly}
        />
      </form>,
    ),
  }
}

beforeEach(() => {
  mediaQueryMock.mockReturnValue(false)
  uploadToS3.mockReset()
  uploadToS3.mockResolvedValue({ url: 'https://example.com/receipt.pdf' })
  toast.mockReset()
})

describe('ExpenseDocumentsInput form drag and drop', () => {
  it('accepts a document dropped anywhere on the expense form and prevents navigation', async () => {
    const { updateDocuments } = renderInput()
    const form = document.querySelector('input[type="file"]')!.closest('form')!
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
    const form = document.querySelector('input[type="file"]')!.closest('form')!
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
    const form = document.querySelector('input[type="file"]')!.closest('form')!
    const first = new File(['one'], 'one.pdf', { type: 'application/pdf' })
    const second = new File(['two'], 'two.pdf', { type: 'application/pdf' })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [first] },
    })
    await waitFor(() => expect(uploadToS3).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole('button', { name: /add attachments|uploading/i }),
    ).toBeDisabled()
    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [second] },
    })
    expect(uploadToS3).toHaveBeenCalledTimes(1)

    resolveUpload({ url: 'https://example.com/one.pdf' })
    await waitFor(() => expect(updateDocuments).toHaveBeenCalledTimes(1))
  })

  it('shows one compact add action in the empty state', () => {
    const { container } = renderInput()

    const addButtons = screen.getAllByRole('button', {
      name: /add attachments/i,
    })
    expect(addButtons).toHaveLength(1)
    const [addButton] = addButtons
    expect(addButton).toHaveClass('min-w-0', 'whitespace-normal')
    expect(
      screen.getByText(
        /images, pdfs, and common receipt documents up to 2 mb/i,
      ),
    ).toHaveClass('max-w-full', 'break-words')
    expect(container.querySelector('[class*="aspect-square"]')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /take photo/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /choose files/i }),
    ).not.toBeInTheDocument()
  })

  it('opens the broad picker directly on desktop', () => {
    mediaQueryMock.mockReturnValue(true)
    const { container } = renderInput()
    const [camera, files] = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    )
    const filesClick = vi.spyOn(files, 'click')

    fireEvent.click(screen.getByRole('button', { name: /add attachments/i }))

    expect(filesClick).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull()
    expect(camera).toHaveAttribute('accept', 'image/*')
    expect(camera).toHaveAttribute('capture', 'environment')
    expect(files).toHaveAttribute('multiple')
    expect(files.accept).toContain('application/pdf')
  })

  it('opens a mobile action sheet with camera and file actions', () => {
    const { container } = renderInput()
    const [camera, files] = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    )
    const cameraClick = vi.spyOn(camera, 'click')
    const filesClick = vi.spyOn(files, 'click')

    fireEvent.click(screen.getByRole('button', { name: /add attachments/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take photo/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /choose files/i })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /take photo/i }))
    expect(cameraClick).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: /add attachments/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose files/i }))
    expect(filesClick).toHaveBeenCalledOnce()
  })

  it('keeps one compact add action below existing documents', () => {
    renderInput({
      documents: [
        {
          id: 'document-1',
          url: 'https://example.com/receipt.pdf',
          fileName: 'receipt.pdf',
          contentType: 'application/pdf',
          width: null,
          height: null,
        },
      ],
    })

    expect(
      screen.getAllByRole('button', { name: /add attachments/i }),
    ).toHaveLength(1)
    expect(screen.queryByText(/add receipt or photo/i)).not.toBeInTheDocument()
  })

  it('does not render upload controls in read-only mode', () => {
    renderInput({ readOnly: true })

    expect(
      screen.queryByRole('button', { name: /add attachments/i }),
    ).toBeNull()
    expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument()
  })

  it('uses stable inputs for direct camera capture and general files', () => {
    const { container } = renderInput()
    const [camera, files] = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    )

    expect(camera).toHaveAttribute('accept', 'image/*')
    expect(camera).toHaveAttribute('capture', 'environment')
    expect(files).toHaveAttribute('multiple')
    expect(files.accept).toContain('application/pdf')
  })
})
