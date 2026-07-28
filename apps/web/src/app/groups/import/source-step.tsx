import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Clock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  extractSpliitGroupIdFromUrl,
  guessGroupNameFromFilename,
  type NormalizedSource,
} from '@spliit/domain/import'

import { DomainSwapCard } from './domain-swap-card'
import { FileUploadCard } from './file-upload-card'
import { PasteUrlCard } from './paste-url-card'
import { PROVIDERS, pickParser, type SourceMode } from './source-providers'
import { SplitwiseAnonymizerCard } from './splitwise-anonymizer-card'
import type { ImportSourceState } from './use-import-source'

type Props = {
  /** Client-parsed file uploads hand the result directly up. */
  onLoaded: (source: NormalizedSource) => void
  onError: (message: string) => void
  /**
   * Shared import-source state owned by the wizard so manual paste and the
   * prefill URL flow write to one `submittedUrl`. The wizard's effect
   * dispatches SOURCE_LOADED whenever the shared preview resolves to OK, so the
   * server-fetch path doesn't need an onLoaded callback here.
   */
  sourcePreview?: ImportSourceState['data']
  isSourcePreviewLoading?: boolean
  sourcePreviewError?: ImportSourceState['error']
  submitPreview: ImportSourceState['submit']
  resetPreview: ImportSourceState['reset']
  /**
   * Error message from a wizard-level prefill that failed before the shared
   * preview resolved to OK. Shown inline next to the URL input until the user
   * starts interacting.
   */
  initialError?: string | null
}

const importRoute = getRouteApi('/groups/import')

export function SourceStep({
  onLoaded,
  onError,
  sourcePreview,
  isSourcePreviewLoading,
  sourcePreviewError,
  submitPreview,
  resetPreview,
  initialError = null,
}: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { source } = importRoute.useSearch()
  const provider = source ?? 'spliit'
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  // Once the user has typed or selected a file, the prefill error no
  // longer applies — the URL they're now typing is unrelated to it.
  const [hasInteracted, setHasInteracted] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const cfg = PROVIDERS[provider]

  // Derive server URL error from source preview / error (instead of
  // syncing via useEffect + setUrlError). Falls back to the prop so
  // a wizard-level prefill failure is visible inline.
  const serverUrlError =
    sourcePreview && sourcePreview.kind !== 'OK'
      ? sourcePreview.kind === 'NOT_FOUND'
        ? t('Groups.Import.Source.notFoundUrl')
        : sourcePreview.message
      : sourcePreviewError
        ? sourcePreviewError.message
        : null
  const displayedUrlError =
    urlError ??
    serverUrlError ??
    (initialError && !hasInteracted ? initialError : null)

  const handleFile = useCallback(
    async (file: File) => {
      setHasInteracted(true)
      try {
        const picked = pickParser(provider, file.name)
        if (!picked.format) {
          onError(t('Groups.Import.Source.unsupportedFileType'))
          return
        }
        const text = await file.text()
        const parsed =
          picked.format === 'json'
            ? picked.parser(JSON.parse(text))
            : picked.parser(text)
        if (!parsed.ok) {
          onError(parsed.error)
          return
        }
        const guessed = guessGroupNameFromFilename(file.name)
        if (guessed) parsed.source.name = guessed
        onLoaded(parsed.source)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('Groups.Import.Source.fileReadError')
        onError(message)
      }
    },
    [provider, onError, onLoaded, t],
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleFile(file)
      e.target.value = ''
    },
    [handleFile],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!cfg.fileImport) return
      e.preventDefault()
      setIsDragging(true)
    },
    [cfg.fileImport],
  )

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!cfg.fileImport) return
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [cfg.fileImport, handleFile],
  )

  const handleUrlSubmit = useCallback(() => {
    setHasInteracted(true)
    setUrlError(null)
    const trimmed = url.trim()
    const sourceGroupId = extractSpliitGroupIdFromUrl(trimmed)
    if (!sourceGroupId) {
      setUrlError(t('Groups.Import.Source.invalidUrl'))
      return
    }
    submitPreview(trimmed)
  }, [url, submitPreview, t])

  const handleUrlChange = useCallback(
    (value: string) => {
      setUrl(value)
      setHasInteracted(true)
      if (urlError) setUrlError(null)
      // Clear server preview so the derived error disappears
      if (sourcePreview || sourcePreviewError) resetPreview()
    },
    [urlError, sourcePreview, sourcePreviewError, resetPreview],
  )

  const tabsListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const activeTab = tabsListRef.current?.querySelector(
      '[data-state="active"]',
    )
    if (activeTab) {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'start' })
    }
  }, [])

  const showFileImport = cfg.fileImport !== null
  const showDomainSwap = cfg.hasDomainSwap
  const showUrlPaste = cfg.hasUrlPaste
  const isSplitwise = provider === 'splitwise'

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={provider}
        onValueChange={(v) =>
          navigate({
            to: '/groups/import',
            search: { source: v as SourceMode },
          })
        }
      >
        <TabsList
          ref={tabsListRef}
          className="w-full justify-start overflow-x-auto sm:w-auto"
        >
          <TabsTrigger value="spliit">
            {t('Groups.Import.Source.fromSpliit')}
          </TabsTrigger>
          <TabsTrigger value="splitwise">
            {t('Groups.Import.Source.splitwise')}
          </TabsTrigger>
          <TabsTrigger value="tricount">
            {t('Groups.Import.Source.tricount')}
          </TabsTrigger>
          <TabsTrigger value="settleup">
            {t('Groups.Import.Source.settleUp')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spliit">
          <ProviderDescription
            description={t('Groups.Import.Source.spliitDescription')}
            receiptTitle={t('Groups.Import.Source.receiptWarningTitle')}
            receiptDescription={t(
              'Groups.Import.Source.receiptWarningDescription',
            )}
          />
        </TabsContent>
        <TabsContent value="splitwise">
          <ProviderDescription
            description={t('Groups.Import.Source.splitwiseDescription')}
            receiptTitle={t(
              'Groups.Import.Source.receiptWarningTitleSplitwise',
            )}
            receiptDescription={t(
              'Groups.Import.Source.receiptWarningDescriptionSplitwise',
            )}
          />
          <SplitwiseAnonymizerCard />
        </TabsContent>
        <TabsContent value="tricount">
          <ComingSoonCard
            title={t('Groups.Import.Source.tricountComingTitle')}
            description={t('Groups.Import.Source.tricountComingDescription')}
          />
        </TabsContent>
        <TabsContent value="settleup">
          <ComingSoonCard
            title={t('Groups.Import.Source.settleUpComingTitle')}
            description={t('Groups.Import.Source.settleUpComingDescription')}
          />
        </TabsContent>
      </Tabs>

      {showDomainSwap && (
        <DomainSwapCard
          title={t('Groups.Import.Source.appToCloudTitle')}
          description={t('Groups.Import.Source.appToCloudDescription')}
        />
      )}

      {showDomainSwap && (showUrlPaste || showFileImport) && (
        <OrDivider label={t('Groups.Import.Source.or')} />
      )}

      {showUrlPaste && (
        <PasteUrlCard
          disabled={false}
          isPending={Boolean(isSourcePreviewLoading)}
          url={url}
          urlError={displayedUrlError}
          onUrlChange={handleUrlChange}
          onSubmit={handleUrlSubmit}
          labels={{
            pasteUrl: t('Groups.Import.Source.pasteUrl'),
            urlDescription: t('Groups.Import.Source.urlDescription'),
            urlPlaceholder: t('Groups.Import.Source.urlPlaceholder'),
            fetchGroupButton: t('Groups.Import.Source.fetchGroupButton'),
            fetchingButton: t('Groups.Import.Source.fetchingButton'),
          }}
        />
      )}

      {showUrlPaste && showFileImport && (
        <OrDivider label={t('Groups.Import.Source.or')} />
      )}

      {showFileImport && cfg.fileImport && (
        <FileUploadCard
          disabled={false}
          isDragging={isDragging}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onFileChange={handleFileChange}
          accept={cfg.accept}
          labels={{
            dropFile: t(
              isSplitwise
                ? 'Groups.Import.Source.dropFileSplitwise'
                : 'Groups.Import.Source.dropFile',
            ),
            dropFileDescription: t(
              isSplitwise
                ? 'Groups.Import.Source.dropFileDescriptionSplitwise'
                : 'Groups.Import.Source.dropFileDescription',
            ),
          }}
        />
      )}

      {provider === 'spliit' && showFileImport && (
        <p className="text-xs text-muted-foreground">
          {t('Groups.Import.Source.csvRecurrenceLimitation')}
        </p>
      )}
    </div>
  )
}

function ProviderDescription({
  description,
  receiptTitle,
  receiptDescription,
}: {
  description: string
  receiptTitle: string
  receiptDescription: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p>
          <strong>{receiptTitle}</strong> {receiptDescription}
        </p>
      </div>
    </div>
  )
}

function ComingSoonCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
      <div className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
