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
import { Loader2, Plus, Trash, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

const MAX_FILE_SIZE = 2 * 1024 ** 2

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
  const { FileInput, openFileDialog, uploadToS3 } = usePresignedUpload(ledgerId) // use presigned uploads to addtionally support providers other than AWS
  const { toast } = useToast()

  const handleFileChange = async (file: File) => {
    const upload = async () => {
      try {
        setPending(true)
        const { file: resizedFile, width, height } = await resizeImage(file)
        if (resizedFile.size > MAX_FILE_SIZE) {
          toast({
            title: t('TooBigToast.title'),
            description: t('TooBigToast.description', {
              maxSize: formatFileSize(MAX_FILE_SIZE, locale),
              size: formatFileSize(resizedFile.size, locale),
            }),
            variant: 'destructive',
          })
          return
        }
        const { url } = await uploadToS3(resizedFile)
        updateDocuments([...documents, { id: randomId(), url, width, height }])
      } catch (err) {
        console.error(err)
        toast({
          title: t('ErrorToast.title'),
          description: t('ErrorToast.description'),
          variant: 'destructive',
          action: (
            <ToastAction
              altText={t('ErrorToast.retry')}
              onClick={() => upload()}
            >
              {t('ErrorToast.retry')}
            </ToastAction>
          ),
        })
      } finally {
        setPending(false)
      }
    }
    upload()
  }

  return (
    <div>
      <FileInput
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      />

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
              onClick={openFileDialog}
              className="w-full h-full"
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="w-8 h-8 animate-spin" />
              ) : (
                <Plus className="w-8 h-8" />
              )}
            </Button>
          </div>
        )}
      </div>
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
  const [currentDocument, setCurrentDocument] = useState<number | null>(null)

  useEffect(() => {
    if (!api) return

    api.on('slidesInView', () => {
      const index = api.slidesInView()[0]
      if (index !== undefined) {
        setCurrentDocument(index)
      }
    })
  }, [api])

  const { t: tExpenseForm } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="relative aspect-square h-full w-full">
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            className="h-full w-full overflow-hidden rounded border shadow-inner"
          >
            <Image
              width={300}
              height={300}
              className="object-contain"
              src={document.url}
              alt=""
            />
          </Button>
        </DialogTrigger>
        {!readOnly && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex">
            {enableReceiptExtract && onReceiptAccepted && (
              <ReceiptScanTrigger
                iconOnly
                autoScan
                title={tExpenseForm('ExpenseForm.scanReceipt')}
                mode="fill"
                documents={[document]}
                currentExpense={receiptContext}
                onAccept={onReceiptAccepted}
                className="h-10 flex-1 rounded-t-none rounded-bl-md rounded-br-none border-r border-secondary-foreground/20 hover:bg-pink-200"
              />
            )}
            <Button
              type="button"
              variant="secondary"
              className={cn(
                'h-10 flex-1 rounded-t-none text-destructive hover:bg-destructive hover:text-destructive-foreground',
                enableReceiptExtract && onReceiptAccepted
                  ? 'rounded-bl-none rounded-br-md border-l-0'
                  : 'rounded-b-md',
              )}
              title="Delete document"
              aria-label="Delete document"
              onClick={() => deleteDocument(document)}
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <DialogContent className="p-4 w-screen max-w-[100vw] h-dvh max-h-dvh sm:max-w-[calc(100vw-32px)] sm:max-h-[calc(100dvh-32px)] *:last:hidden">
        <DialogTitle className="sr-only">Document</DialogTitle>
        <DialogDescription className="sr-only"></DialogDescription>
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            {!readOnly && (
              <div className="flex gap-2">
                {enableReceiptExtract && onReceiptAccepted && (
                  <ReceiptScanTrigger
                    title={tExpenseForm('ExpenseForm.scanReceipt')}
                    autoScan
                    mode="fill"
                    documents={[document]}
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
                      currentDocument !== null
                        ? documents[currentDocument]
                        : document,
                    )
                    setOpen(false)
                  }}
                >
                  <Trash className="mr-2 h-4 w-4" />
                  Delete document
                </Button>
              </div>
            )}
            <DialogClose asChild>
              <Button variant="ghost">
                <X className="w-4 h-4 mr-2" /> Close
              </Button>
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
              {documents.map((document, index) => (
                <CarouselItem key={index}>
                  <Image
                    className="object-contain w-[calc(100vw-32px)] h-[calc(100dvh-32px-40px-16px-48px)] sm:w-[calc(100vw-32px-32px)] sm:h-[calc(100dvh-32px-40px-16px-32px-48px)]"
                    src={document.url}
                    width={document.width}
                    height={document.height}
                    alt=""
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-0 top-auto -bottom-16" />
            <CarouselNext className="right-0 top-auto -bottom-16" />
          </Carousel>
        </div>
      </DialogContent>
    </Dialog>
  )
}
