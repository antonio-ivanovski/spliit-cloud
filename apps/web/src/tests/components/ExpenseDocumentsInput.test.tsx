import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import { useMediaQuery } from '@/lib/hooks'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { resizeImage } from '@/lib/upload'
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
  uploadFile,
  maxDocuments,
  maxDocumentsReachedLabel,
}: {
  readOnly?: boolean
  updateDocuments?: (documents: ExpenseFormInputValues['documents']) => void
  documents?: ExpenseFormInputValues['documents']
  uploadFile?: (input: {
    file: File
    width: number | null
    height: number | null
  }) => Promise<ExpenseFormInputValues['documents'][number]>
  maxDocuments?: number
  maxDocumentsReachedLabel?: string
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
          uploadFile={uploadFile}
          maxDocuments={maxDocuments}
          maxDocumentsReachedLabel={maxDocumentsReachedLabel}
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
  vi.mocked(resizeImage).mockReset()
  vi.mocked(resizeImage).mockImplementation(async (file: File) => ({
    file,
    width: 100,
    height: 100,
  }))
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

describe('ExpenseDocumentsInput injected uploadFile', () => {
  it('uses the injected transport instead of the ledger hook', async () => {
    const injected = vi.fn(
      async ({
        file,
      }: {
        file: File
        width: number | null
        height: number | null
      }) => ({
        id: 'personal-1',
        url: 'https://example.com/personal/receipt.jpg',
        fileName: file.name,
        contentType: 'image/jpeg',
        width: 100,
        height: 100,
      }),
    )
    const { updateDocuments } = renderInput({ uploadFile: injected })
    const form = document.querySelector('input[type="file"]')!.closest('form')!
    const file = new File(['receipt'], 'receipt.jpg', {
      type: 'image/jpeg',
    })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await waitFor(() => expect(updateDocuments).toHaveBeenCalledTimes(1))
    expect(injected).toHaveBeenCalledWith({
      file,
      width: 100,
      height: 100,
    })
    expect(uploadToS3).not.toHaveBeenCalled()
    expect(updateDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'personal-1',
        url: 'https://example.com/personal/receipt.jpg',
      }),
    ])
  })

  it('does not call the injected transport in read-only mode', async () => {
    const injected = vi.fn()
    const { updateDocuments } = renderInput({
      readOnly: true,
      uploadFile: injected,
    })
    const form = document.querySelector('input[type="file"]')!.closest('form')!
    const file = new File(['receipt'], 'receipt.jpg', {
      type: 'image/jpeg',
    })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(injected).not.toHaveBeenCalled()
    expect(updateDocuments).not.toHaveBeenCalled()
  })

  it('shows a single shared toast for unsupported injected files', async () => {
    const injected = vi.fn()
    renderInput({ uploadFile: injected })
    const form = document.querySelector('input[type="file"]')!.closest('form')!
    const file = new File(['binary'], 'setup.exe', {
      type: 'application/octet-stream',
    })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(injected).not.toHaveBeenCalled()
  })
})

describe('ExpenseDocumentsInput maxDocuments', () => {
  function pdfDocument(
    id: string,
  ): ExpenseFormInputValues['documents'][number] {
    return {
      id,
      url: `https://example.com/${id}.pdf`,
      fileName: `${id}.pdf`,
      contentType: 'application/pdf',
      width: null,
      height: null,
    }
  }

  it('hides the add affordance and shows the limit note at the cap', () => {
    renderInput({
      documents: [pdfDocument('a'), pdfDocument('b')],
      maxDocuments: 2,
      maxDocumentsReachedLabel: 'Limit reached',
    })

    expect(
      screen.queryByRole('button', { name: /add attachments/i }),
    ).toBeNull()
    expect(screen.getByText('Limit reached')).toBeInTheDocument()
  })

  it('falls back to the shared limit string without a label', () => {
    renderInput({
      documents: [pdfDocument('a'), pdfDocument('b')],
      maxDocuments: 2,
    })

    expect(
      screen.queryByRole('button', { name: /add attachments/i }),
    ).toBeNull()
    expect(screen.getByText(/maximum of 2 attachments/i)).toBeInTheDocument()
  })

  it('refuses files at the cap without uploading', async () => {
    const injected = vi.fn()
    const { updateDocuments } = renderInput({
      documents: [pdfDocument('a'), pdfDocument('b')],
      uploadFile: injected,
      maxDocuments: 2,
      maxDocumentsReachedLabel: 'Limit reached',
    })
    const form = document.querySelector('input[type="file"]')!.closest('form')!
    const file = new File(['receipt'], 'receipt.pdf', {
      type: 'application/pdf',
    })

    fireEvent.drop(form, {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(injected).not.toHaveBeenCalled()
    expect(uploadToS3).not.toHaveBeenCalled()
    expect(updateDocuments).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('stops a multi-file drop at the cap', async () => {
    const injected = vi.fn(
      async ({
        file,
      }: {
        file: File
        width: number | null
        height: number | null
      }) => ({
        id: file.name,
        url: `https://example.com/${file.name}`,
        fileName: file.name,
        contentType: 'application/pdf',
        width: null,
        height: null,
      }),
    )
    const updateDocuments = vi.fn()
    renderInput({
      documents: [pdfDocument('a')],
      updateDocuments,
      uploadFile: injected,
      maxDocuments: 2,
    })
    const form = document.querySelector('input[type="file"]')!.closest('form')!

    fireEvent.drop(form, {
      dataTransfer: {
        types: ['Files'],
        files: [
          new File(['one'], 'one.pdf', { type: 'application/pdf' }),
          new File(['two'], 'two.pdf', { type: 'application/pdf' }),
        ],
      },
    })

    await waitFor(() => expect(updateDocuments).toHaveBeenCalledTimes(1))
    expect(injected).toHaveBeenCalledTimes(1)
    expect(updateDocuments).toHaveBeenCalledWith([
      pdfDocument('a'),
      expect.objectContaining({ id: 'one.pdf' }),
    ])
  })
})
