import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRouter } from '@/lib/navigation'
import {
  extractSpliitGroupIdFromUrl,
  guessGroupNameFromFilename,
  tryParseSpliitCsv,
  tryParseSpliitExport,
  tryParseSplitwiseCsv,
  type ImportParseResult,
  type NormalizedSource,
} from '@spliit/domain/import'
import { getRouteApi } from '@tanstack/react-router'
import { AlertTriangle, Clock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DomainSwapCard } from './domain-swap-card'
import { FileUploadCard } from './file-upload-card'
import { PasteUrlCard } from './paste-url-card'
import { SplitwiseAnonymizerCard } from './splitwise-anonymizer-card'
import { useImportSource } from './use-import-source'

type Props = {
  onLoaded: (source: NormalizedSource) => void
  onError: (message: string) => void
}

type SourceMode = 'spliit' | 'splitwise' | 'tricount' | 'settleup'

const importRoute = getRouteApi('/groups/import')

type FileParser =
  | ((text: string) => ImportParseResult)
  | ((input: unknown) => ImportParseResult)

type ProviderConfig = {
  hasUrlPaste: boolean
  hasDomainSwap: boolean
  fileImport: { csv: FileParser; json: FileParser | null } | null
  accept: string
}

const PROVIDERS: Record<SourceMode, ProviderConfig> = {
  spliit: {
    hasUrlPaste: true,
    hasDomainSwap: true,
    fileImport: { csv: tryParseSpliitCsv, json: tryParseSpliitExport },
    accept: '.json,.csv,application/json,text/csv',
  },
  splitwise: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { csv: tryParseSplitwiseCsv, json: null },
    accept: '.csv,text/csv',
  },
  tricount: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: null,
    accept: '',
  },
  settleup: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: null,
    accept: '',
  },
}

export function pickParser(
  provider: SourceMode,
  fileName: string,
):
  | { format: 'csv'; parser: FileParser }
  | { format: 'json'; parser: FileParser }
  | { format: null } {
  const cfg = PROVIDERS[provider]
  if (!cfg.fileImport) return { format: null }
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) {
    return { format: 'csv', parser: cfg.fileImport.csv }
  }
  if (lower.endsWith('.json')) {
    if (!cfg.fileImport.json) return { format: null }
    return { format: 'json', parser: cfg.fileImport.json }
  }
  return { format: null }
}

export function SourceStep({ onLoaded, onError }: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const { source } = importRoute.useSearch()
  const provider = source ?? 'spliit'
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const {
    data: sourcePreview,
    isLoading: isPreviewLoading,
    error: sourcePreviewError,
    submit: submitPreview,
    reset: resetPreview,
  } = useImportSource()

  const cfg = PROVIDERS[provider]

  // Derive server URL error from source preview / error (instead of
  // syncing via useEffect + setUrlError).
  const serverUrlError =
    sourcePreview && sourcePreview.kind !== 'OK'
      ? sourcePreview.kind === 'NOT_FOUND'
        ? t('Groups.Import.Source.notFoundUrl')
        : sourcePreview.message
      : sourcePreviewError
        ? sourcePreviewError.message
        : null

  // Keep only the onLoaded transition in an effect (not a setState
  // call, so not flagged by set-state-in-effect).
  useEffect(() => {
    if (sourcePreview?.kind === 'OK') {
      onLoaded(sourcePreview.source)
      resetPreview()
    }
  }, [sourcePreview, resetPreview, onLoaded])

  const handleFile = useCallback(
    async (file: File) => {
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
      if (file) handleFile(file)
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
      if (file) handleFile(file)
    },
    [cfg.fileImport, handleFile],
  )

  const handleUrlSubmit = useCallback(() => {
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
          router.push({
            to: '/groups/import',
            search: { source: v as SourceMode },
          })
        }
      >
        <TabsList
          ref={tabsListRef}
          className="w-full sm:w-auto overflow-x-auto justify-start"
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
          isPending={isPreviewLoading}
          url={url}
          urlError={urlError ?? serverUrlError}
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
    <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
