import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  FileText,
  Loader2,
  Paperclip,
  ScanLine,
  Search,
  Share,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AiExpensePreview,
  type AiExpenseDraft,
} from '@/app/groups/[groupId]/expenses/ai-expense-preview'
import {
  ReceiptScanTrigger,
  type ReceiptDocument,
  type ReceiptExtractedInfo,
} from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import type { GroupShape } from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import { CollapsibleSection } from '@/app/groups/collapsible-section'
import { partitionGroups, type AccountGroup } from '@/app/groups/group-buckets'
import { GroupCard } from '@/app/groups/group-card'
import Image from '@/components/app-image'
import { useDocumentTitle } from '@/components/document-title'
import { FilePickerInput } from '@/components/file-picker-input'
import { PageShell } from '@/components/layout/page-shell'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { usePwaUpdateBlocker } from '@/lib/pwa-update-blockers'
import {
  deletePendingShare,
  getPendingShare,
  putPendingShare,
} from '@/lib/share-target-store'
import { resizeImage, useExpenseDocumentUpload } from '@/lib/upload'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { cn, formatFileSize } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import {
  isExpenseDocumentImage,
  isExpenseDocumentSizeWithinLimit,
  isScannableReceiptDocument,
  isSupportedExpenseDocumentUpload,
  mimeTypeForExpenseDocumentFileName,
  MAX_EXPENSE_DOCUMENT_SIZE,
  RECEIPT_SCAN_ACCEPT,
  type CategoryId,
} from '@spliit/domain'

const shareTargetRouteApi = getRouteApi('/share-target')

type StagedFile = {
  key: string
  file: File
}

type UploadedDoc = {
  key: string
  document: ReceiptDocument
}

type GroupFilter = 'all' | 'groups' | 'friends'

function isImageFile(file: File): boolean {
  return (
    isExpenseDocumentImage(file.type) ||
    (mimeTypeForExpenseDocumentFileName(file.name)?.startsWith('image/') ??
      false)
  )
}

function textFileName(title: string | null): string {
  const base =
    title
      ?.replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'shared-note'
  return `${base}.txt`
}

function randomKey(fallback: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : fallback
}

function StagedFileRow({
  staged,
  selected,
  readOnly = false,
  onSelect,
  onRemove,
}: {
  staged: StagedFile
  selected: boolean
  readOnly?: boolean
  onSelect?: () => void
  onRemove?: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ShareTarget' })
  const locale = useLocale()
  const previewUrl = useMemo(
    () =>
      staged.file.type.startsWith('image/')
        ? URL.createObjectURL(staged.file)
        : null,
    [staged.file],
  )
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  const body = (
    <>
      {previewUrl ? (
        <Image
          src={previewUrl}
          alt=""
          width={300}
          height={300}
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {staged.file.name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatFileSize(staged.file.size, locale)}
        </span>
      </span>
      {selected && (
        <Check aria-hidden className="ms-auto h-4 w-4 shrink-0 text-primary" />
      )}
    </>
  )

  if (readOnly) {
    // Share flow: no add/remove/convert actions, but the row stays a real
    // selection button (with `aria-pressed`) so multi-file shares can pick
    // which file to turn into an expense next.
    return (
      <li
        className={cn(
          'flex items-center gap-3 rounded-lg border p-2',
          selected && 'border-primary ring-1 ring-primary',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
          aria-pressed={selected}
        >
          {body}
        </button>
      </li>
    )
  }

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border p-2',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-start"
        aria-pressed={selected}
      >
        {body}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={t('discardAction')}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  )
}

export default function ShareTargetPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'ShareTarget' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tExpenses } = useTranslation(undefined, {
    keyPrefix: 'Expenses',
  })
  const { t: tSplitPreset } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.SplitPreset',
  })
  const { t: tReceipt } = useTranslation(undefined, {
    keyPrefix: 'CreateFromReceipt',
  })
  const { t: tOffline } = useTranslation()
  useDocumentTitle(t('title'))
  const search = shareTargetRouteApi.useSearch()
  const navigate = useNavigate()
  const { toast } = useToast()
  const locale = useLocale()
  const isOnline = useOnlineStatus()
  const maxFileSize =
    useDeploymentConfig().maxExpenseDocumentSize ?? MAX_EXPENSE_DOCUMENT_SIZE
  const { data: account, isPending: isAccountPending } = useCurrentAccount()

  const [shareStatus, setShareStatus] = useState<
    'idle' | 'loading' | 'ready' | 'failed'
  >(search.share ? 'loading' : 'idle')
  const [shareText, setShareText] = useState<{
    title: string | null
    text: string
  } | null>(null)
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [manualText, setManualText] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [pickerExpanded, setPickerExpanded] = useState(true)
  const [uploaded, setUploaded] = useState<UploadedDoc | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadNonce, setUploadNonce] = useState(0)
  const [scanOpen, setScanOpen] = useState(false)
  const [previewDraft, setPreviewDraft] = useState<AiExpenseDraft | null>(null)
  // Completion tracking for the staged system share: the IDB entry is
  // deleted only once every item it carried was handled (uploaded into a
  // flow, converted, or explicitly removed) — completing one file must
  // never destroy the others.
  const [shareFileKeys, setShareFileKeys] = useState<string[]>([])
  const [hadShareText, setHadShareText] = useState(false)
  const [handledKeys, setHandledKeys] = useState<string[]>([])
  const [textHandled, setTextHandled] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  usePwaUpdateBlocker(uploading, 'share-target-upload')
  usePwaUpdateBlocker(scanOpen || previewDraft !== null, 'share-target-scan')

  // Load the staged system share (if any) exactly once per share id. The
  // files card is a readonly summary in the share flow: text-only shares are
  // converted eagerly into a `.txt` staged file, while text arriving alongside
  // files is shown as read-only context (a caption) and marked consumed, so it
  // never blocks cleanup and is never silently dropped as a phantom file.
  useEffect(() => {
    if (!search.share) return
    let cancelled = false
    // oxlint-disable-next-line react/set-state-in-effect -- reset the status when the incoming share id changes.
    setShareStatus('loading')
    void getPendingShare(search.share)
      .then((entry) => {
        if (cancelled) return
        if (!entry) {
          setShareStatus('failed')
          return
        }
        const files = entry.files.map((item, index) => ({
          key: randomKey(`share-${index}-${item.size}`),
          file: new File([item.blob], item.name, {
            type: item.type || 'application/octet-stream',
          }),
        }))
        const combined = [entry.text, entry.url].filter(
          (part): part is string =>
            !!part && !(entry.text?.includes(part) && part === entry.url),
        )
        if (files.length === 0 && combined.length > 0) {
          const text = combined.join('\n\n')
          const textFile = {
            key: randomKey(`share-text-${text.length}`),
            file: new File([text], textFileName(entry.title), {
              type: 'text/plain',
            }),
          }
          setStagedFiles([textFile])
          setSelectedKey(textFile.key)
          setShareFileKeys([textFile.key])
          setHandledKeys([])
          setTextHandled(false)
          setShareText(null)
          setHadShareText(false)
        } else {
          setStagedFiles(files)
          setSelectedKey(files[0]?.key ?? null)
          setShareFileKeys(files.map((item) => item.key))
          setHandledKeys([])
          setShareText(
            combined.length > 0
              ? { title: entry.title, text: combined.join('\n\n') }
              : null,
          )
          setHadShareText(combined.length > 0)
          // Caption text travels with the files: consumed from the start.
          setTextHandled(combined.length > 0)
        }
        setShareStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setShareStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [search.share])

  const markHandled = useCallback((key: string) => {
    setHandledKeys((current) =>
      current.includes(key) ? current : [...current, key],
    )
  }, [])

  // Persist share progress before leaving the page: drops the just-handled
  // file from the staged IDB entry (or deletes the entry when it was the
  // last item) so a remount — e.g. system back from the expense form in a
  // multi-file share — resumes with exactly the remaining files. Awaiting this
  // before navigating is what guarantees cleanup: the state-driven deletion
  // effect below cannot flush once this page unmounts.
  const persistRemainingShare = useCallback(
    async (handledKey: string) => {
      if (!search.share) return
      const remaining = stagedFiles.filter(
        (item) =>
          item.key !== handledKey &&
          shareFileKeys.includes(item.key) &&
          !handledKeys.includes(item.key),
      )
      if (remaining.length === 0 && (textHandled || !hadShareText)) {
        await deletePendingShare(search.share).catch(() => undefined)
        return
      }
      await putPendingShare({
        id: search.share,
        title: null,
        text: null,
        url: null,
        files: remaining.map((item) => ({
          name: item.file.name,
          type: item.file.type,
          size: item.file.size,
          blob: item.file,
        })),
      }).catch(() => undefined)
    },
    [
      search.share,
      stagedFiles,
      shareFileKeys,
      handledKeys,
      hadShareText,
      textHandled,
    ],
  )

  // Delete the staged entry once everything it carried is handled. Keyed
  // off the share id so a repeat share in the same tab starts fresh.
  useEffect(() => {
    if (!search.share || shareStatus !== 'ready') return
    const total = shareFileKeys.length + (hadShareText ? 1 : 0)
    if (total === 0) return
    const done =
      shareFileKeys.filter((key) => handledKeys.includes(key)).length +
      (textHandled ? 1 : 0)
    if (done >= total) {
      void deletePendingShare(search.share).catch(() => undefined)
    }
  }, [
    search.share,
    shareStatus,
    shareFileKeys,
    handledKeys,
    hadShareText,
    textHandled,
  ])

  const overviewQuery = trpc.overview.get.useQuery(undefined, {
    enabled: !!account,
  })
  const writableGroups = useMemo(
    () =>
      (overviewQuery.data?.groups ?? []).filter(
        (group: AccountGroup) => group.access === 'MEMBER' && !group.archived,
      ),
    [overviewQuery.data],
  )
  const partitionedGroups = useMemo(
    () => partitionGroups(writableGroups),
    [writableGroups],
  )
  const visibleBuckets = useMemo(() => {
    const query = groupQuery.trim().toLowerCase()
    const matchesQuery = (group: AccountGroup) =>
      !query || group.displayName.toLowerCase().includes(query)
    const matchesFilter = (group: AccountGroup) =>
      groupFilter === 'all' ||
      (groupFilter === 'groups'
        ? group.groupType !== 'FRIEND'
        : group.groupType === 'FRIEND')
    const inScope = (group: AccountGroup) =>
      matchesQuery(group) && matchesFilter(group)
    return {
      starred: partitionedGroups.starred.filter(inScope),
      groups: partitionedGroups.groups.filter(inScope),
      friends: partitionedGroups.friends.filter(inScope),
      hidden: partitionedGroups.hidden.filter(inScope),
    }
  }, [partitionedGroups, groupQuery, groupFilter])
  const hasVisibleGroups =
    visibleBuckets.starred.length > 0 ||
    visibleBuckets.groups.length > 0 ||
    visibleBuckets.friends.length > 0 ||
    visibleBuckets.hidden.length > 0
  const selectedAccountGroup =
    writableGroups.find((item) => item.id === selectedGroupId) ?? null

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId)
    setPickerExpanded(false)
  }, [])

  const groupQueryResult = trpc.groups.get.useQuery(
    { groupId: selectedGroupId ?? '' },
    { enabled: !!account && !!selectedGroupId },
  )
  const group: GroupShape | null = groupQueryResult.data?.group ?? null
  const currentLedgerParticipantId =
    groupQueryResult.data?.currentLedgerParticipantId ?? null
  const { uploadToS3 } = useExpenseDocumentUpload(group?.ledgerId)

  const selectedFile =
    stagedFiles.find((item) => item.key === selectedKey) ??
    stagedFiles[0] ??
    null

  // In the system-share flow the files card is a readonly summary: the
  // picker, text composer, and remove actions only exist for the manual
  // (direct URL, nothing shared) state.
  const isShareFlow =
    shareStatus === 'ready' && !!search.share && shareFileKeys.length > 0

  // Upload the selected file as soon as its destination group is known, so
  // both follow-up paths (AI scan, manual attach) start without extra waits.
  useEffect(() => {
    if (!selectedFile || !group || !isOnline) {
      // oxlint-disable-next-line react/set-state-in-effect -- drop the staged upload when the selection or destination goes away.
      setUploaded((current) =>
        current?.key === selectedFile?.key ? current : null,
      )
      return
    }
    if (uploaded?.key === selectedFile.key) return
    let cancelled = false
    setUploading(true)
    setUploadError(null)
    setUploaded(null)
    void (async () => {
      try {
        const prepared = isImageFile(selectedFile.file)
          ? await resizeImage(selectedFile.file).then(
              ({ file, width, height }) => ({ file, width, height }),
            )
          : {
              file: selectedFile.file,
              width: null as number | null,
              height: null as number | null,
            }
        if (cancelled) return
        if (
          !isExpenseDocumentSizeWithinLimit(prepared.file.size, maxFileSize)
        ) {
          setUploadError(
            t('uploadError', {
              maxSize: formatFileSize(maxFileSize, locale),
              size: formatFileSize(prepared.file.size, locale),
            }),
          )
          return
        }
        const { url } = await uploadToS3(prepared.file)
        if (cancelled) return
        setUploaded({
          key: selectedFile.key,
          document: {
            id: randomKey(`doc-${Date.now()}`),
            url,
            width: prepared.width,
            height: prepared.height,
            fileName: prepared.file.name,
            contentType: prepared.file.type,
          },
        })
      } catch {
        if (!cancelled) setUploadError(t('uploadErrorGeneric'))
      } finally {
        if (!cancelled) setUploading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // uploadNonce re-runs the effect for the retry button; uploadToS3 and
    // neighbors are stable across renders.
    // oxlint-disable-next-line exhaustive-deps
  }, [selectedFile?.key, group?.ledgerId, isOnline, uploadNonce])

  const selectedScannable =
    !!selectedFile &&
    isSupportedExpenseDocumentUpload({
      fileName: selectedFile.file.name,
      contentType: selectedFile.file.type,
    }) &&
    isScannableReceiptDocument({
      fileName: selectedFile.file.name,
      contentType: selectedFile.file.type,
    })

  const canAct =
    !!account &&
    !!group &&
    !!uploaded &&
    uploaded.key === selectedFile?.key &&
    !uploading &&
    isOnline

  const handleScanAccept = (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => {
    if (!group) return
    setPreviewDraft({
      source: 'receipt',
      title: result.info.title,
      amount: result.info.amount,
      amountUnit: 'minor',
      currencyCode: result.info.currencyCode,
      date: result.info.date,
      categoryId: result.info.categoryId as CategoryId | null,
      items: result.info.items,
      document: result.document,
      issues: [],
    })
    setScanOpen(false)
  }

  const handlePreviewCreated = (expenseId: string) => {
    if (!group || !selectedFile) return
    const currentKey = selectedFile.key
    const remaining = shareFileKeys.filter(
      (key) => key !== currentKey && !handledKeys.includes(key),
    )
    markHandled(currentKey)
    if (remaining.length > 0) {
      // More shared files remain: stay on the page and advance to the next
      // one so every file gets its own expense instead of being dropped. The
      // preview dialog closes itself after `onCreated`, and the upload effect
      // picks up the newly selected file automatically.
      setSelectedKey(remaining[0] ?? null)
      return
    }
    void (async () => {
      await persistRemainingShare(currentKey)
      await navigate({
        to: '/groups/$groupId/expenses/$expenseId',
        params: { groupId: group.id, expenseId },
        replace: true,
        resetScroll: false,
      })
    })()
  }

  const handlePreviewContinueInForm = () => {
    // The uploaded file travels with the form prefill, so it is handed off.
    // Best-effort IDB persist: the edit link navigates synchronously, so a
    // multi-file resume is not guaranteed here — but nothing is lost either
    // (the staged entry survives and reloads in full).
    const currentKey = uploaded?.key ?? selectedFile?.key
    if (currentKey) {
      markHandled(currentKey)
      void persistRemainingShare(currentKey)
    }
  }

  // Unhandled staged share keys, for the multi-file flow: the edit-form link
  // only replaces history once the last file is handed off.
  const unhandledShareKeys = useMemo(
    () => shareFileKeys.filter((key) => !handledKeys.includes(key)),
    [shareFileKeys, handledKeys],
  )
  const isLastShareFile =
    selectedFile == null ||
    !shareFileKeys.includes(selectedFile.key) ||
    unhandledShareKeys.length <= 1

  const handleAttach = () => {
    if (!group || !uploaded || uploaded.key !== selectedFile?.key) return
    const currentKey = uploaded.key
    const remaining = shareFileKeys.filter(
      (key) => key !== currentKey && !handledKeys.includes(key),
    )
    const isLast = remaining.length === 0
    markHandled(currentKey)
    const document = uploaded.document
    void (async () => {
      await persistRemainingShare(currentKey)
      await navigate({
        to: '/groups/$groupId/expenses/create',
        params: { groupId: group.id },
        search: {
          imageUrl: document.url,
          ...(document.width != null
            ? { imageWidth: String(document.width) }
            : {}),
          ...(document.height != null
            ? { imageHeight: String(document.height) }
            : {}),
          ...(document.fileName ? { fileName: document.fileName } : {}),
          ...(document.contentType
            ? { contentType: document.contentType }
            : {}),
          fromShare: '1',
        },
        // Push (not replace) while files remain so system back returns to
        // the share-target page — remounted with exactly the remaining files
        // thanks to the persist above — for the next file.
        replace: isLast,
      })
    })()
  }

  const addFiles = (files: File[]) => {
    const supported = files.filter((file) =>
      isSupportedExpenseDocumentUpload({
        fileName: file.name,
        contentType: file.type,
      }),
    )
    if (supported.length !== files.length) {
      toast({ description: t('unsupportedFile'), variant: 'destructive' })
    }
    if (supported.length === 0) return
    setStagedFiles((current) => {
      const next = [
        ...current,
        ...supported.map((file, index) => ({
          key: `manual-${Date.now()}-${index}-${file.name}`,
          file,
        })),
      ]
      setSelectedKey((selected) => selected ?? next[0]?.key ?? null)
      return next
    })
  }

  const addTextAsFile = (text: string, title: string | null) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const file = new File([trimmed], textFileName(title), {
      type: 'text/plain',
    })
    addFiles([file])
    setManualText('')
    if (shareText && text === shareText.text) {
      setShareText(null)
      setTextHandled(true)
    }
  }

  const removeStagedFile = (key: string) => {
    // Explicit removal counts as handled so a discarded file never blocks
    // cleanup of the staged share.
    markHandled(key)
    setStagedFiles((current) => {
      const next = current.filter((item) => item.key !== key)
      setSelectedKey((selected) =>
        selected === key ? (next[0]?.key ?? null) : selected,
      )
      return next
    })
    setUploaded((current) => (current?.key === key ? null : current))
  }

  if (isAccountPending) {
    return (
      <PageShell className="flex-col gap-4 py-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </PageShell>
    )
  }

  if (!account) {
    const redirect = search.share
      ? `/share-target/?share=${encodeURIComponent(search.share)}`
      : '/share-target/'
    return (
      <PageShell className="flex-col gap-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('signInDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              nativeButton={false}
              render={<Link to="/" search={{ redirect }} />}
            >
              {t('signInAction')}
              <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" />
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell className="flex-col gap-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Share className="h-5 w-5 text-muted-foreground" />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {!isOnline && (
        <output className="rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          {tOffline('OfflineReadOnly.reconnectToEdit')}
        </output>
      )}
      {(search.error || shareStatus === 'failed') && (
        <output className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/20 dark:text-amber-200">
          {t('loadFailed')}
        </output>
      )}

      {shareStatus === 'loading' ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('filesLabel')}</CardTitle>
              {!isShareFlow && (
                <CardDescription>{t('manualDescription')}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isShareFlow ? (
                <>
                  {shareText && (
                    <div className="rounded-lg border bg-muted/25 p-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {t('sharedTextLabel')}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">
                        {shareText.text}
                      </p>
                    </div>
                  )}
                  {stagedFiles.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {stagedFiles.map((staged) => (
                        <StagedFileRow
                          key={staged.key}
                          staged={staged}
                          selected={staged.key === selectedFile?.key}
                          readOnly
                          onSelect={() => setSelectedKey(staged.key)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <FilePickerInput
                    ref={fileInputRef}
                    onFilesSelected={addFiles}
                    accept={RECEIPT_SCAN_ACCEPT}
                    multiple
                    className="hidden"
                  />
                  {stagedFiles.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {stagedFiles.map((staged) => (
                        <StagedFileRow
                          key={staged.key}
                          staged={staged}
                          selected={staged.key === selectedFile?.key}
                          onSelect={() => setSelectedKey(staged.key)}
                          onRemove={() => removeStagedFile(staged.key)}
                        />
                      ))}
                    </ul>
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="me-2 h-4 w-4" />
                      {t('chooseFile')}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 border-t pt-3">
                    {shareText && (
                      <div className="rounded-lg border bg-muted/25 p-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t('sharedTextLabel')}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">
                          {shareText.text}
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            addTextAsFile(shareText.text, shareText.title)
                          }
                        >
                          <FileText className="me-2 h-4 w-4" />
                          {t('useTextAsFile')}
                        </Button>
                      </div>
                    )}
                    <Textarea
                      value={manualText}
                      onChange={(event) => setManualText(event.target.value)}
                      placeholder={t('textPlaceholder')}
                      rows={3}
                    />
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!manualText.trim()}
                        onClick={() => addTextAsFile(manualText, null)}
                      >
                        <FileText className="me-2 h-4 w-4" />
                        {t('addTextAction')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('pickGroupLabel')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : selectedAccountGroup && !pickerExpanded ? (
                <div className="flex flex-col gap-2">
                  <ul className="grid items-stretch gap-3 sm:grid-cols-2">
                    <GroupCard
                      group={selectedAccountGroup}
                      onSelect={() => setPickerExpanded(true)}
                      selectAriaLabel={`${selectedAccountGroup.displayName} (${tSplitPreset('change')})`}
                    />
                  </ul>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPickerExpanded(true)}
                    >
                      {tSplitPreset('change')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:rotate-180" />
                    <Input
                      value={groupQuery}
                      onChange={(event) => setGroupQuery(event.target.value)}
                      placeholder={t('searchPlaceholder')}
                      className="ps-9"
                      aria-label={t('searchPlaceholder')}
                    />
                  </div>
                  <Tabs
                    value={groupFilter}
                    onValueChange={(value) =>
                      setGroupFilter(value as GroupFilter)
                    }
                  >
                    <TabsList>
                      <TabsTrigger value="all">
                        {tExpenses('filters.viewMode.all')}
                      </TabsTrigger>
                      <TabsTrigger value="groups">
                        {tGroups('groups')}
                      </TabsTrigger>
                      <TabsTrigger value="friends">
                        {tGroups('friends')}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {!hasVisibleGroups ? (
                    <p className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
                      {t('noGroups')}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {visibleBuckets.starred.length > 0 && (
                        <CollapsibleSection
                          storageKey="spliit:share-target:section:starred"
                          defaultOpen
                          title={tGroups('starred')}
                        >
                          <ul className="grid items-stretch gap-3 sm:grid-cols-2">
                            {visibleBuckets.starred.map((item) => (
                              <GroupCard
                                key={item.id}
                                group={item}
                                variant="starred"
                                onSelect={handleSelectGroup}
                              />
                            ))}
                          </ul>
                        </CollapsibleSection>
                      )}
                      {visibleBuckets.groups.length > 0 && (
                        <CollapsibleSection
                          storageKey="spliit:share-target:section:groups"
                          defaultOpen
                          title={tGroups('groups')}
                        >
                          <ul className="grid items-stretch gap-3 sm:grid-cols-2">
                            {visibleBuckets.groups.map((item) => (
                              <GroupCard
                                key={item.id}
                                group={item}
                                variant="groups"
                                onSelect={handleSelectGroup}
                              />
                            ))}
                          </ul>
                        </CollapsibleSection>
                      )}
                      {visibleBuckets.friends.length > 0 && (
                        <CollapsibleSection
                          storageKey="spliit:share-target:section:friends"
                          defaultOpen
                          title={tGroups('friends')}
                        >
                          <ul className="grid items-stretch gap-3 sm:grid-cols-2">
                            {visibleBuckets.friends.map((item) => (
                              <GroupCard
                                key={item.id}
                                group={item}
                                variant="friends"
                                onSelect={handleSelectGroup}
                              />
                            ))}
                          </ul>
                        </CollapsibleSection>
                      )}
                      {visibleBuckets.hidden.length > 0 && (
                        <CollapsibleSection
                          storageKey="spliit:share-target:section:hidden"
                          defaultOpen={false}
                          title={tGroups('hidden')}
                        >
                          <ul className="grid items-stretch gap-3 opacity-60 sm:grid-cols-2">
                            {visibleBuckets.hidden.map((item) => (
                              <GroupCard
                                key={item.id}
                                group={item}
                                variant="hidden"
                                onSelect={handleSelectGroup}
                              />
                            ))}
                          </ul>
                        </CollapsibleSection>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {selectedGroupId && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {group?.name ??
                    selectedAccountGroup?.displayName ??
                    t('pickGroupLabel')}
                </CardTitle>
                <CardDescription>
                  {uploading
                    ? t('uploadingFile')
                    : (uploadError ?? t('actionsDescription'))}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {uploading && (
                  <output className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('uploadingFile')}
                  </output>
                )}
                {uploadError && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                    <span className="flex-1">{uploadError}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setUploadNonce((nonce) => nonce + 1)}
                    >
                      {tReceipt('ErrorToast.retry')}
                    </Button>
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    disabled={!canAct || !selectedScannable}
                    onClick={() => setScanOpen(true)}
                    title={
                      selectedFile && !selectedScannable
                        ? t('notScannableHint')
                        : undefined
                    }
                  >
                    <ScanLine className="me-2 h-4 w-4" />
                    {t('scanAction')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canAct}
                    onClick={handleAttach}
                  >
                    <Upload className="me-2 h-4 w-4" />
                    {t('attachAction')}
                  </Button>
                </div>
                {selectedFile && !selectedScannable && (
                  <p className="text-xs text-muted-foreground">
                    {t('notScannableHint')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {group && uploaded && (
        <ReceiptScanTrigger
          hideTrigger
          open={scanOpen}
          onOpenChange={setScanOpen}
          mode="create"
          autoScan
          directAccept
          group={group}
          documents={[uploaded.document]}
          onAccept={handleScanAccept}
        />
      )}
      {group && previewDraft && (
        <AiExpensePreview
          open
          onOpenChange={(open) => {
            if (!open) setPreviewDraft(null)
          }}
          group={group}
          currentLedgerParticipantId={currentLedgerParticipantId}
          draft={previewDraft}
          onCreated={handlePreviewCreated}
          onContinueInForm={handlePreviewContinueInForm}
          shareOrigin
          shareOriginReplace={isLastShareFile}
        />
      )}
    </PageShell>
  )
}
