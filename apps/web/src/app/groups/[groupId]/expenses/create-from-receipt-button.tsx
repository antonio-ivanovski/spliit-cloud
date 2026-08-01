import { Check, FileQuestion, ScanLine, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AiExpensePreview,
  type AiExpenseDraft,
} from '@/app/groups/[groupId]/expenses/ai-expense-preview'
import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import Image from '@/components/app-image'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { resizeImage, usePresignedUpload } from '@/lib/upload'
import {
  cn,
  formatCurrency,
  formatDate,
  formatFileSize,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import {
  categoryIdSchema,
  getCategoryById,
  localeLabels,
  type CategoryId,
  type Locale,
} from '@spliit/domain'

import {
  useCurrentGroup,
  useCurrentGroupOrNull,
} from '../current-group-context'
import { AiCaptureDialog } from './ai-capture-dialog'
import type { GroupShape } from './expense-form/default-values'

const MAX_FILE_SIZE = 2 * 1024 ** 2
const TRANSLATE_STORAGE_KEY = 'spliit-receipt-translate-to-locale'

function readTranslatePreference(): boolean {
  try {
    return window.localStorage.getItem(TRANSLATE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeTranslatePreference(value: boolean): void {
  try {
    window.localStorage.setItem(TRANSLATE_STORAGE_KEY, String(value))
  } catch {
    // storage unavailable — preference simply won't persist
  }
}

export type ReceiptExtractedInfo = {
  amount: number
  categoryId: string | null
  currencyCode: string | null
  date: string | null
  title: string | null
  items: Array<{ title: string; unitPrice: number; quantity: number }>
}

export type ReceiptDocument = {
  id: string
  url: string
  width: number
  height: number
}

export type ReceiptScanContext = {
  title?: string
  amount?: number
  date?: string
  currencyCode?: string
  categoryId?: string
  items?: Array<{ title: string; unitPrice: number; quantity: number }>
}

export function ReceiptScanTrigger({
  documents = [],
  currentExpense,
  onAccept,
  className,
  mode = 'create',
  iconOnly = false,
  responsive = false,
  autoScan = false,
  title,
  children,
  group: groupOverride,
  open: openOverride,
  onOpenChange: onOpenChangeOverride,
  hideTrigger = false,
  directAccept = false,
}: {
  documents?: ReceiptDocument[]
  currentExpense?: ReceiptScanContext
  onAccept?: (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => void
  className?: string
  mode?: 'create' | 'fill'
  iconOnly?: boolean
  responsive?: boolean
  autoScan?: boolean
  title?: string
  children?: ReactNode
  group?: GroupShape
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  /** Skip the receipt review step and hand the extracted result to the caller. */
  directAccept?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openOverride ?? internalOpen
  const setOpen = onOpenChangeOverride ?? setInternalOpen
  // iconOnly && !responsive → always icon-only
  // iconOnly && responsive → icon-only on mobile, full on desktop
  // !iconOnly → always full
  const isAlwaysIconOnly = iconOnly && !responsive
  const isResponsiveIconOnly = iconOnly && responsive
  const showText = !isAlwaysIconOnly
  return (
    <>
      <AiCaptureDialog
        open={open}
        onOpenChange={setOpen}
        icon={ScanLine}
        title={t(mode === 'fill' ? 'Dialog.fillTitle' : 'Dialog.title')}
        description={t('Dialog.description')}
        trigger={
          hideTrigger ? undefined : (
            <Button
              type="button"
              variant="secondary"
              size={isAlwaysIconOnly ? 'icon' : 'default'}
              className={cn(
                isResponsiveIconOnly &&
                  'h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-4 sm:py-2',
                className,
              )}
              title={title}
              aria-label={title}
            >
              <span className={cn('relative inline-flex', showText && 'mr-2')}>
                <ScanLine className="h-6 w-6 sm:h-4 sm:w-4" />
                <Sparkles className="absolute -top-[2px] -right-[1px] h-3.5 w-3.5 animate-[pulse_2.4s_ease-in-out_infinite] text-pink-600 drop-shadow-[0_0_4px_rgba(236,72,153,0.75)] sm:h-2.5 sm:w-2.5" />
              </span>
              {showText && (
                <span
                  className={cn(isResponsiveIconOnly && 'hidden sm:inline')}
                >
                  {children ?? t('Dialog.triggerTitle')}
                </span>
              )}
            </Button>
          )
        }
      >
        <ReceiptDialogContent
          key={open ? 'open' : 'closed'}
          documents={documents}
          currentExpense={currentExpense}
          groupOverride={groupOverride}
          mode={mode}
          autoScan={autoScan}
          directAccept={directAccept}
          open={open}
          onAccept={(result) => {
            onAccept?.(result)
            setOpen(false)
          }}
        />
      </AiCaptureDialog>
    </>
  )
}

export function CreateFromReceiptButton({
  className,
  responsive = false,
  iconOnly = false,
  open,
  onOpenChange,
  onFlowActiveChange,
  hideTrigger = false,
  directAccept = true,
}: {
  className?: string
  responsive?: boolean
  iconOnly?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onFlowActiveChange?: (active: boolean) => void
  hideTrigger?: boolean
  directAccept?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  const { group, currentLedgerParticipantId } = useCurrentGroup()
  const [internalOpen, setInternalOpen] = useState(false)
  const [previewDraft, setPreviewDraft] = useState<AiExpenseDraft | null>(null)
  const previewPendingRef = useRef(false)
  const captureOpen = open ?? internalOpen
  const setCaptureOpen = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    onFlowActiveChange?.(
      nextOpen || previewDraft !== null || previewPendingRef.current,
    )
  }

  return (
    <>
      <ReceiptScanTrigger
        className={className}
        iconOnly={iconOnly}
        responsive={responsive}
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        hideTrigger={hideTrigger}
        directAccept={directAccept}
        title={t('Dialog.triggerTitle')}
        onAccept={({ info, document }) => {
          if (!group) return
          previewPendingRef.current = true
          setPreviewDraft({
            source: 'receipt',
            title: info.title,
            amount: info.amount,
            amountUnit: 'minor',
            currencyCode: info.currencyCode,
            date: info.date,
            categoryId: info.categoryId as CategoryId | null,
            items: info.items,
            document,
            issues: [],
          })
          onFlowActiveChange?.(true)
        }}
      >
        {t('Dialog.triggerTitle')}
      </ReceiptScanTrigger>
      {group && previewDraft && (
        <AiExpensePreview
          open
          onOpenChange={(open) => {
            if (!open) {
              previewPendingRef.current = false
              setPreviewDraft(null)
              onFlowActiveChange?.(false)
            }
          }}
          group={group}
          currentLedgerParticipantId={currentLedgerParticipantId}
          draft={previewDraft}
        />
      )}
    </>
  )
}

function ReceiptDialogContent({
  documents,
  currentExpense,
  groupOverride,
  mode,
  autoScan,
  directAccept,
  open,
  onAccept,
}: {
  documents: ReceiptDocument[]
  currentExpense?: ReceiptScanContext
  groupOverride?: GroupShape
  mode: 'create' | 'fill'
  autoScan: boolean
  directAccept: boolean
  open: boolean
  onAccept?: (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => void
}) {
  const currentGroup = useCurrentGroupOrNull()
  const group = groupOverride ?? currentGroup?.group
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  const { t: tExpenseForm } = useTranslation()
  const [pending, setPending] = useState(false)
  const [selectedDocument, setSelectedDocument] =
    useState<ReceiptDocument | null>(null)
  const [receiptInfo, setReceiptInfo] = useState<ReceiptExtractedInfo | null>(
    null,
  )
  const [translateToLocale, setTranslateToLocale] = useState(
    readTranslatePreference,
  )
  const translateRef = useRef(translateToLocale)
  useEffect(() => {
    translateRef.current = translateToLocale
  })
  const { uploadToS3, FileInput, openFileDialog } = usePresignedUpload(
    group?.ledgerId,
  )
  const { toast } = useToast()
  const extractReceiptMutation =
    trpc.ai.extractExpenseInformationFromImage.useMutation()

  const scan = async (
    document: ReceiptDocument,
    translate = translateToLocale,
  ) => {
    if (!group) return
    setSelectedDocument(document)
    setReceiptInfo(null)
    try {
      setPending(true)
      const result = await extractReceiptMutation.mutateAsync({
        imageUrl: document.url,
        currency: group.currency,
        currencyCode: group.currencyCode,
        groupId: group.id,
        locale,
        translateToLocale: translate,
        currentExpense,
      })
      setReceiptInfo(result)
      if (mode === 'create' && directAccept) {
        onAccept?.({ info: result, document })
      }
    } catch (err) {
      console.error(err)
      toast({
        title: t('ErrorToast.title'),
        description: t('ErrorToast.description'),
        variant: 'destructive',
        action: (
          <ToastAction
            altText={t('ErrorToast.retry')}
            onClick={() => scan(document, translateRef.current)}
          >
            {t('ErrorToast.retry')}
          </ToastAction>
        ),
      })
    } finally {
      setPending(false)
    }
  }

  // Mirror `scan` in a ref so the auto-scan effect depends only on the
  // inputs that should drive it, without listing every closure capture.
  // The ref is resynced on every render — the assignment is cheap and
  // always reads the latest closure.
  const scanRef = useRef(scan)
  useEffect(() => {
    scanRef.current = scan
  })

  useEffect(() => {
    if (!open || !autoScan || documents.length !== 1 || selectedDocument) return
    void scanRef.current(documents[0])
  }, [autoScan, documents, open, selectedDocument])

  const handleFileChange = async (file: File) => {
    try {
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
      setPending(true)
      const { url } = await uploadToS3(resizedFile)
      const document = { id: crypto.randomUUID(), url, width, height }
      setSelectedDocument(document)
      setReceiptInfo(null)
      await scan(document)
    } catch (err) {
      console.error(err)
      toast({
        title: t('ErrorToast.title'),
        description: t('ErrorToast.description'),
        variant: 'destructive',
      })
    } finally {
      setPending(false)
    }
  }

  const languageLabel = localeLabels[locale as Locale] ?? localeLabels['en-US']

  const handleTranslateChange = (checked: boolean | 'indeterminate') => {
    const next = checked === true
    setTranslateToLocale(next)
    writeTranslatePreference(next)
    if (selectedDocument && receiptInfo && !pending) {
      void scan(selectedDocument, next)
    }
  }

  const parsedCategory = receiptInfo?.categoryId
    ? categoryIdSchema.safeParse(receiptInfo.categoryId)
    : null
  const category = parsedCategory?.success
    ? getCategoryById(parsedCategory.data)
    : null

  return (
    <div className="prose prose-sm dark:prose-invert">
      <p>{t(mode === 'fill' ? 'Dialog.fillBody' : 'Dialog.body')}</p>
      <div className="not-prose mb-4 flex items-center gap-2">
        <Checkbox
          id="receipt-translate-to-locale"
          checked={translateToLocale}
          onCheckedChange={handleTranslateChange}
          disabled={pending}
        />
        <Label
          htmlFor="receipt-translate-to-locale"
          className="cursor-pointer font-normal"
        >
          {t('Dialog.translateToLocale', { language: languageLabel })}
        </Label>
      </div>
      <FileInput
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      />
      {!selectedDocument && documents.length > 0 && (
        <div className="not-prose mb-4 space-y-2">
          <p className="text-sm font-medium">{t('Dialog.existingDocuments')}</p>
          <div className="grid grid-cols-4 gap-2">
            {documents.map((document) => (
              <Button
                key={document.id}
                type="button"
                variant="secondary"
                className="h-20 overflow-hidden p-1"
                onClick={() => scan(document)}
                disabled={pending}
              >
                <Image
                  src={document.url}
                  width={document.width}
                  height={document.height}
                  className="h-full w-full object-contain"
                  alt={t('Dialog.existingDocumentAlt')}
                />
              </Button>
            ))}
          </div>
        </div>
      )}
      {!selectedDocument && (
        <Button
          type="button"
          variant="outline"
          className="not-prose w-full"
          onClick={openFileDialog}
          disabled={pending}
        >
          <ScanLine className="mr-2 h-4 w-4" />
          {t('Dialog.uploadAndScan')}
        </Button>
      )}
      {selectedDocument && (
        <>
          <div className="not-prose mb-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
            <div className="relative col-span-2 flex min-h-48 justify-center overflow-hidden rounded border bg-muted/20">
              <Image
                src={selectedDocument.url}
                width={selectedDocument.width}
                height={selectedDocument.height}
                className="max-h-72 w-auto max-w-full object-contain"
                alt={t('Dialog.scannedReceiptAlt')}
              />
              {pending && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 p-3 text-center text-xs font-medium text-foreground backdrop-blur-[1px]">
                  <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-pink-500/15 text-pink-600 shadow-[0_0_24px_rgba(236,72,153,0.55)]">
                    <ScanLine className="h-7 w-7 animate-pulse" />
                    <Sparkles className="absolute -top-1 -right-1 h-6 w-6 animate-[pulse_1.2s_ease-in-out_infinite] text-pink-600 drop-shadow-[0_0_9px_rgba(236,72,153,1)]" />
                  </span>
                  <span>{t('Dialog.scanningHint')}</span>
                </div>
              )}
            </div>
            {receiptInfo ? (
              <>
                <div>
                  <strong>{t('Dialog.titleLabel')}</strong>
                  <div>{receiptInfo.title ?? <Unknown />}</div>
                </div>
                <div>
                  <strong>{t('Dialog.categoryLabel')}</strong>
                  <div>
                    {category ? (
                      <span className="inline-flex items-center gap-1">
                        <CategoryIcon category={category} className="h-4 w-4" />
                        {category.name}
                      </span>
                    ) : (
                      <Unknown />
                    )}
                  </div>
                </div>
                <div>
                  <strong>{t('Dialog.amountLabel')}</strong>
                  <div>
                    {group
                      ? formatCurrency(
                          receiptInfo.currencyCode
                            ? (getCurrency(receiptInfo.currencyCode) ??
                                getCurrencyFromGroup(group))
                            : getCurrencyFromGroup(group),
                          receiptInfo.amount,
                          locale,
                        )
                      : '…'}
                  </div>
                </div>
                <div>
                  <strong>{t('Dialog.dateLabel')}</strong>
                  <div>
                    {receiptInfo.date ? (
                      formatDate(
                        new Date(`${receiptInfo.date}T12:00:00.000Z`),
                        locale,
                        { dateStyle: 'medium' },
                      )
                    ) : (
                      <Unknown />
                    )}
                  </div>
                </div>
                <div className="col-span-2">
                  <strong>{tExpenseForm('ExpenseForm.items.title')}</strong>
                  <div>
                    {receiptInfo.items.length ? (
                      receiptInfo.items
                        .map((item) => `${item.title} × ${item.quantity}`)
                        .join(', ')
                    ) : (
                      <Unknown />
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          {receiptInfo && (
            <>
              <p>
                {t(mode === 'fill' ? 'Dialog.fillNext' : 'Dialog.editNext')}
              </p>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!group) return
                    onAccept?.({
                      info: receiptInfo,
                      document: selectedDocument,
                    })
                  }}
                >
                  <Check className="mr-2 h-4 w-4" />
                  {t('Dialog.continue')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Unknown() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <FileQuestion className="h-4 w-4" />
      <em>{t('unknown')}</em>
    </span>
  )
}
