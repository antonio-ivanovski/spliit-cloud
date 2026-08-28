import { Camera, FileText, Loader2, Plus, Trash, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ReceiptScanTrigger,
  type ReceiptDocument,
  type ReceiptExtractedInfo,
  type ReceiptScanContext,
} from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import Image from '@/components/app-image'
import { Button } from '@/components/ui/button'
import type { CarouselApi } from '@/components/ui/carousel'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import {
  // Intentionally bypasses `ResponsiveDialog`: this is a full-screen
  // document viewer that fills the viewport (carousel of receipts).
  // Pulling it into a mobile bottom-drawer would defeat its purpose.
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { randomId } from '@/lib/api'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { resizeImage, usePresignedUpload } from '@/lib/upload'
import { cn, formatFileSize } from '@/lib/utils'
import {
  EXPENSE_DOCUMENT_ACCEPT,
  MAX_EXPENSE_DOCUMENT_SIZE,
  isExpenseDocumentSizeWithinLimit,
  isExpenseDocumentImage,
  isSupportedExpenseDocumentUpload,
  mimeTypeForExpenseDocumentFileName,
} from '@spliit/domain'

type Props = {
  documents: ExpenseFormInputValues['documents']
  updateDocuments: (documents: ExpenseFormInputValues['documents']) => void
  ledgerId?: string | null
  readOnly?: boolean
  enableReceiptExtract?: boolean
  receiptContext?: ReceiptScanContext
  onReceiptAccepted?: (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => void
}

const MAX_FILE_SIZE = MAX_EXPENSE_DOCUMENT_SIZE

function isImageAttachment(
  document: ExpenseFormInputValues['documents'][number],
): boolean {
  return (
    isExpenseDocumentImage(document.contentType) ||
    (!document.contentType && document.width != null && document.height != null)
  )
}

export function ExpenseDocumentsInput({
  documents,
  updateDocuments,
  ledgerId,
  readOnly = false,
  enableReceiptExtract = false,
  receiptContext,
  onReceiptAccepted,
}: Props) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseDocumentsInput',
  })
  const [pending, setPending] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const { FileInput, openFileDialog, uploadToS3 } = usePresignedUpload(ledgerId) // use presigned uploads to additionally support providers other than AWS
  const { toast } = useToast()
  const toastRef = useRef(toast)
  const tRef = useRef(t)
  const updateDocumentsRef = useRef(updateDocuments)
  const documentsRef = useRef(documents)
  const pendingRef = useRef(pending)
  useEffect(() => {
    toastRef.current = toast
  }, [toast])
  useEffect(() => {
    tRef.current = t
  }, [t])
  useEffect(() => {
    updateDocumentsRef.current = updateDocuments
  }, [updateDocuments])
  useEffect(() => {
    documentsRef.current = documents
    pendingRef.current = pending
  }, [documents, pending])

  const uploadFile = useCallback(
    async (file: File) => {
      if (
        !isSupportedExpenseDocumentUpload({
          fileName: file.name,
          contentType: file.type,
        })
      ) {
        toast({
          title: t('UnsupportedToast.title'),
          description: t('UnsupportedToast.description', {
            fileName: file.name,
          }),
          variant: 'destructive',
        })
        return null
      }

      const image =
        isExpenseDocumentImage(file.type) ||
        mimeTypeForExpenseDocumentFileName(file.name)?.startsWith('image/')
      const prepared = image
        ? await resizeImage(file)
        : { file, width: null, height: null }
      if (!isExpenseDocumentSizeWithinLimit(prepared.file.size)) {
        toast({
          title: t('TooBigToast.title'),
          description: t('TooBigToast.description', {
            maxSize: formatFileSize(MAX_FILE_SIZE, locale),
            size: formatFileSize(prepared.file.size, locale),
          }),
          variant: 'destructive',
        })
        return null
      }
      const { url } = await uploadToS3(prepared.file)
      return {
        id: randomId(),
        url,
        fileName: prepared.file.name,
        contentType: image
          ? prepared.file.type || 'image/jpeg'
          : (mimeTypeForExpenseDocumentFileName(file.name) ??
            prepared.file.type),
        width: prepared.width,
        height: prepared.height,
      }
    },
    [locale, t, toast, uploadToS3],
  )

  const uploadFileRef = useRef(uploadFile)
  useEffect(() => {
    uploadFileRef.current = uploadFile
  }, [uploadFile])

  // Keep one stable callback for the native form drag listeners; the latest
  // mutable values are read through refs updated by effects above.
  // oxlint-disable-next-line react/react-compiler
  const handleFiles = useCallback(async (files: File[]) => {
    if (pendingRef.current) return
    if (!files.length) {
      // Some mobile pickers (Android DocumentsUI in standalone PWA) can return
      // with an empty file list and fire no further event. Surface it so the
      // failure is visible instead of silently doing nothing.
      console.warn('File picker returned without any file (input.files empty)')
      toastRef.current({
        title: tRef.current('NoFilesToast.title'),
        description: tRef.current('NoFilesToast.description'),
        variant: 'destructive',
      })
      return
    }
    pendingRef.current = true
    setPending(true)
    const added: NonNullable<Awaited<ReturnType<typeof uploadFile>>>[] = []
    try {
      // Keep dropped files in their original order so the attachment grid is
      // predictable after a multi-file drop.
      for (const file of files) {
        try {
          const document = await uploadFileRef.current?.(file)
          if (document) added.push(document)
        } catch (err) {
          console.error(err)
          toastRef.current({
            title: tRef.current('ErrorToast.title'),
            description: tRef.current('FileErrorToast.description', {
              fileName: file.name,
            }),
            variant: 'destructive',
            action: (
              <ToastAction
                altText={tRef.current('ErrorToast.retry')}
                onClick={() => void handleFiles([file])}
              >
                {tRef.current('ErrorToast.retry')}
              </ToastAction>
            ),
          })
        }
      }
      if (added.length) {
        updateDocumentsRef.current([...documentsRef.current, ...added])
      }
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [])

  const handleFilesRef = useRef(handleFiles)
  useEffect(() => {
    handleFilesRef.current = handleFiles
  }, [handleFiles])

  useEffect(() => {
    const form = rootRef.current?.closest('form[data-expense-form]')
    if (!form || readOnly) return

    const handleDragEnter = (event: Event) => {
      const dragEvent = event as DragEvent
      if (!dragEvent.dataTransfer?.types.includes('Files')) return
      dragEvent.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const handleDragLeave = (event: Event) => {
      event.preventDefault()
      dragDepth.current -= 1
      if (dragDepth.current <= 0) {
        dragDepth.current = 0
        setDragActive(false)
      }
    }
    const handleDragOver = (event: Event) => event.preventDefault()
    const handleDrop = (event: Event) => {
      const dragEvent = event as DragEvent
      dragEvent.preventDefault()
      dragDepth.current = 0
      setDragActive(false)
      void handleFilesRef.current(
        Array.from(dragEvent.dataTransfer?.files ?? []),
      )
    }

    form.addEventListener('dragenter', handleDragEnter, true)
    form.addEventListener('dragleave', handleDragLeave, true)
    form.addEventListener('dragover', handleDragOver, true)
    form.addEventListener('drop', handleDrop, true)
    return () => {
      form.removeEventListener('dragenter', handleDragEnter, true)
      form.removeEventListener('dragleave', handleDragLeave, true)
      form.removeEventListener('dragover', handleDragOver, true)
      form.removeEventListener('drop', handleDrop, true)
    }
  }, [readOnly])

  return (
    <div ref={rootRef} className="relative">
      <FileInput
        onFilesChange={handleFiles}
        accept={EXPENSE_DOCUMENT_ACCEPT}
        multiple
      />
      <FileInput
        inputId="camera"
        onFilesChange={handleFiles}
        accept="image/*"
        capture="environment"
      />

      {dragActive && !readOnly && (
        <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/95 p-6 text-center shadow-lg">
          <div>
            <Upload className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-medium">{t('dropTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('dropDescription')}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {documents.map((doc) => (
          <DocumentThumbnail
            key={doc.id}
            document={doc}
            documents={documents}
            deleteDocument={(document) => {
              updateDocuments(documents.filter((d) => d.id !== document.id))
            }}
            readOnly={readOnly}
            enableReceiptExtract={enableReceiptExtract}
            receiptContext={receiptContext}
            onReceiptAccepted={onReceiptAccepted}
          />
        ))}

        {!readOnly && (
          <div className="aspect-square">
            <Button
              variant="secondary"
              type="button"
              onClick={() => openFileDialog()}
              className="h-full min-h-0 w-full"
              disabled={pending}
              aria-label={t('chooseFiles')}
            >
              {pending ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <Plus className="h-8 w-8" />
              )}
              <span className="sr-only">{t('chooseFiles')}</span>
            </Button>
          </div>
        )}
      </div>
      {!readOnly && (
        <Button
          variant="outline"
          type="button"
          onClick={() => openFileDialog('camera')}
          className="mt-2 w-full sm:hidden"
          disabled={pending}
        >
          <Camera className="me-2 h-4 w-4" />
          {t('takePhoto')}
        </Button>
      )}
    </div>
  )
}

export function DocumentThumbnail({
  document,
  documents,
  deleteDocument,
  readOnly = false,
  enableReceiptExtract = false,
  receiptContext,
  onReceiptAccepted,
}: {
  document: ExpenseFormInputValues['documents'][number]
  documents: ExpenseFormInputValues['documents']
  deleteDocument: (
    document: ExpenseFormInputValues['documents'][number],
  ) => void
  readOnly?: boolean
  enableReceiptExtract?: boolean
  receiptContext?: ReceiptScanContext
  onReceiptAccepted?: (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const [api, setApi] = useState<CarouselApi>()
  const currentDocumentRef = useRef<number | null>(null)

  useEffect(() => {
    if (!api) return

    const handleSlidesInView = () => {
      const index = api.slidesInView()[0]
      if (index !== undefined) {
        currentDocumentRef.current = index
      }
    }

    api.on('slidesInView', handleSlidesInView)

    return () => {
      api.off('slidesInView', handleSlidesInView)
    }
  }, [api])

  const { t: tExpenseForm } = useTranslation()
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseDocumentsInput',
  })
  const imageAttachment = isImageAttachment(document)
  const receiptDocument =
    imageAttachment && document.width != null && document.height != null
      ? {
          id: document.id,
          url: document.url,
          width: document.width,
          height: document.height,
        }
      : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="relative aspect-square h-full w-full">
        <DialogTrigger
          render={
            <Button
              variant="secondary"
              className="h-full w-full overflow-hidden rounded border shadow-inner"
            />
          }
        >
          {imageAttachment ? (
            <Image
              width={document.width ?? 300}
              height={document.height ?? 300}
              className="object-contain"
              src={document.url}
              alt=""
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <span className="line-clamp-3 text-xs font-medium">
                {document.fileName ?? t('document')}
              </span>
            </div>
          )}
        </DialogTrigger>
        {!readOnly && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex">
            {enableReceiptExtract && onReceiptAccepted && receiptDocument && (
              <ReceiptScanTrigger
                iconOnly
                autoScan
                title={tExpenseForm('ExpenseForm.scanReceipt')}
                mode="fill"
                documents={[receiptDocument]}
                currentExpense={receiptContext}
                onAccept={onReceiptAccepted}
                className="h-10 min-w-0 flex-1 basis-0 rounded-t-none rounded-br-none rounded-bl-md border-e border-secondary-foreground/20 bg-secondary/70 backdrop-blur-sm hover:bg-pink-200/70"
              />
            )}
            <Button
              type="button"
              variant="secondary"
              className={cn(
                'h-10 min-w-0 flex-1 basis-0 rounded-t-none bg-secondary/70 text-destructive backdrop-blur-sm hover:bg-destructive/70 hover:text-destructive-foreground',
                enableReceiptExtract && onReceiptAccepted && receiptDocument
                  ? 'rounded-br-md rounded-bl-none border-s-0'
                  : 'rounded-b-md',
              )}
              title={t('deleteDocument')}
              aria-label={t('deleteDocument')}
              onClick={() => deleteDocument(document)}
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <DialogContent className="h-dvh max-h-dvh w-screen max-w-[100vw] p-4 *:last:hidden sm:max-h-[calc(100dvh-32px)] sm:max-w-[calc(100vw-32px)]">
        <DialogTitle className="sr-only">{t('document')}</DialogTitle>
        <DialogDescription className="sr-only"></DialogDescription>
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            {!readOnly && (
              <div className="flex gap-2">
                {enableReceiptExtract &&
                  onReceiptAccepted &&
                  receiptDocument && (
                    <ReceiptScanTrigger
                      title={tExpenseForm('ExpenseForm.scanReceipt')}
                      autoScan
                      mode="fill"
                      documents={[receiptDocument]}
                      currentExpense={receiptContext}
                      onAccept={onReceiptAccepted}
                    >
                      {tExpenseForm('ExpenseForm.scanReceipt')}
                    </ReceiptScanTrigger>
                  )}
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    deleteDocument(
                      currentDocumentRef.current !== null
                        ? documents[currentDocumentRef.current]
                        : document,
                    )
                    setOpen(false)
                  }}
                >
                  <Trash className="me-2 h-4 w-4" />
                  {t('deleteDocument')}
                </Button>
              </div>
            )}
            <DialogClose render={<Button variant="ghost" />}>
              <X className="me-2 h-4 w-4" /> {t('close')}
            </DialogClose>
          </div>

          <Carousel
            opts={{
              startIndex: documents.indexOf(document),
              loop: true,
              align: 'center',
            }}
            setApi={setApi}
          >
            <CarouselContent>
              {documents.map((document) => (
                <CarouselItem key={document.url}>
                  {isImageAttachment(document) ? (
                    <Image
                      className="h-[calc(100dvh-32px-40px-16px-48px)] w-[calc(100vw-32px)] object-contain sm:h-[calc(100dvh-32px-40px-16px-32px-48px)] sm:w-[calc(100vw-32px-32px)]"
                      src={document.url}
                      width={document.width ?? 300}
                      height={document.height ?? 300}
                      alt=""
                    />
                  ) : (
                    <div className="flex h-[calc(100dvh-32px-40px-16px-48px)] flex-col items-center justify-center gap-4 text-center sm:h-[calc(100dvh-32px-40px-16px-32px-48px)]">
                      <FileText className="h-20 w-20 text-muted-foreground" />
                      <p className="max-w-md font-medium break-words">
                        {document.fileName ?? t('document')}
                      </p>
                      <Button
                        nativeButton={false}
                        render={
                          <a
                            href={document.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t('openDocument')}
                          >
                            <span className="sr-only">{t('openDocument')}</span>
                          </a>
                        }
                      >
                        {t('openDocument')}
                      </Button>
                    </div>
                  )}
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="start-0 top-auto -bottom-16" />
            <CarouselNext className="end-0 top-auto -bottom-16" />
          </Carousel>
        </div>
      </DialogContent>
    </Dialog>
  )
}
