import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PageInset } from '@/components/layout/page-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDeploymentConfig } from '@/lib/deployment-config'
import {
  classifyImportPayload,
  classifyImportBytes,
  classifyImportText,
  decodeSettleUpText,
  detectProvidersFromText,
  extractSpliitGroupIdFromUrl,
  guessGroupNameFromFilename,
  runParseSingle,
  runParseSpliitJson,
  type NormalizedSource,
  type ProviderId,
} from '@spliit/domain/import'

import {
  inspectSpliitCloudBundle,
  MAX_CLOUD_DOCUMENT_BYTES,
  type CloudBundleInspection,
} from './cloud-bundle'
import { DomainSwapCard } from './domain-swap-card'
import { ExportGuideTrigger } from './export-guide'
import { FileUploadCard } from './file-upload-card'
import { GenericSourceTab } from './generic-source-tab'
import { PasteUrlCard } from './paste-url-card'
import {
  PROVIDERS,
  getFileGuide,
  getProviderCopy,
  getTabLabels,
  pickParser,
  type SourceMode,
} from './source-providers'
import { SplitwiseAnonymizerCard } from './splitwise-anonymizer-card'
import type { ImportSourceState } from './use-import-source'

type Props = {
  /** Client-parsed file uploads hand the result directly up. */
  onLoaded: (source: NormalizedSource) => void
  onCloudLoaded?: (source: CloudBundleInspection) => void
  /** Multi-group Tricount dumps hand the selected groups up for queueing. */
  onMultiLoaded?: (sources: NormalizedSource[]) => void
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
  retainedCloudBundle?: { onResume: () => void }
}

type WrongImporter = {
  target: 'spliit' | 'spliit-cloud'
  file: File
  messageKey: 'cloud' | 'spliit'
}

const importRoute = getRouteApi('/groups/import')

export function SourceStep({
  onLoaded,
  onCloudLoaded,
  onMultiLoaded,
  onError,
  sourcePreview,
  isSourcePreviewLoading,
  sourcePreviewError,
  submitPreview,
  resetPreview,
  initialError = null,
  retainedCloudBundle,
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
  const [wrongImporter, setWrongImporter] = useState<WrongImporter | null>(null)
  // A known export dropped on the wrong tab hands off here: navigation flips
  // the provider, then the effect below re-parses the file on the owning tab.
  const [pendingHandoff, setPendingHandoff] = useState<{
    file: File
    target: SourceMode
  } | null>(null)
  const maxCloudDocumentBytes =
    useDeploymentConfig().maxExpenseDocumentSize ?? MAX_CLOUD_DOCUMENT_BYTES

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
        // Read once: the same bytes drive zip detection, text decode, and
        // parsing. Raw bytes decode first (Settle Up UTF-16 would mangle
        // through `file.text()`); undecodable bytes keep the legacy
        // fileReadError surface.
        const rawBytes = new Uint8Array(await file.arrayBuffer())
        const isZip =
          classifyImportBytes(rawBytes.slice(0, 4)).kind ===
          'SPLIIT_CLOUD_BUNDLE'

        const flagWrongImporter = (
          target: 'spliit' | 'spliit-cloud',
          wrongFile: File,
        ) =>
          setWrongImporter({
            target,
            file: wrongFile,
            messageKey: target === 'spliit-cloud' ? 'cloud' : 'spliit',
          })
        const isCloudManifest = (kind: string) =>
          kind === 'SPLIIT_CLOUD_MANIFEST'

        // Cloud bundles and cross-importer drops route on bytes + content,
        // not on the active tab. Zip signatures always belong to the Cloud
        // flow; Cloud manifests renamed to .csv/.txt are detected by
        // content so they still land on the right tab.
        if (isZip) {
          if (provider !== 'spliit-cloud') {
            flagWrongImporter('spliit-cloud', file)
            return
          }
          onCloudLoaded?.(
            await inspectSpliitCloudBundle(file, maxCloudDocumentBytes),
          )
          return
        }
        const content = decodeSettleUpText(rawBytes)
        if (content === null || rawBytes.length === 0) {
          onError(t('Groups.Import.Source.fileReadError'))
          return
        }
        const text = content
        // Extension-driven JSON first: a `.json` drop on the spliit tab gets
        // the specific malformed/unsupported-shape error below instead of the
        // generic routing error (content probes cannot classify bad JSON).
        const pickedEarly = pickParser(provider, file.name)
        if (pickedEarly.format === 'json') {
          let body: unknown
          try {
            body = JSON.parse(text)
          } catch {
            onError('This file is not a supported spliit.app JSON export.')
            return
          }
          const jsonParsed = runParseSpliitJson(body)
          if (!jsonParsed.ok) {
            if (classifyImportPayload(body).kind === 'SPLIIT_CLOUD_MANIFEST') {
              flagWrongImporter('spliit-cloud', file)
              return
            }
            onError(jsonParsed.error)
            return
          }
          const guessedEarly = guessGroupNameFromFilename(
            file.name,
            jsonParsed.source.provider,
          )
          if (guessedEarly) jsonParsed.source.name = guessedEarly
          onLoaded(jsonParsed.source)
          return
        }
        const contentClassification = classifyImportText(file.name, text)
        if (isCloudManifest(contentClassification.kind)) {
          if (provider !== 'spliit-cloud') {
            flagWrongImporter('spliit-cloud', file)
            return
          }
          throw new Error(t('Groups.Import.Source.cloudZipRequired'))
        }

        if (provider === 'spliit-cloud') {
          if (
            contentClassification.kind === 'SPLIIT_APP_JSON' ||
            contentClassification.kind === 'SPLIIT_APP_CSV'
          ) {
            flagWrongImporter('spliit', file)
            return
          }
          throw new Error(t('Groups.Import.Source.cloudZipRequired'))
        }

        // Data-driven routing: which registered providers accept this
        // payload? Unknown bytes match nothing; a known export dropped on
        // the wrong tab hands off to the owning tab (which re-parses on
        // arrival), so the parse below only runs for the active provider.
        const accepted = detectProvidersFromText(text)
        if (accepted.length === 0) {
          onError(t('Groups.Import.Source.unsupportedFileType'))
          return
        }
        if (!accepted.includes(provider as ProviderId)) {
          const owner = accepted[0]!
          if (owner === 'spliit') {
            flagWrongImporter('spliit', file)
            return
          }
          setPendingHandoff({ file, target: owner })
          void navigate({
            to: '/groups/import',
            search: { source: owner },
          })
          return
        }

        const picked = pickParser(provider, file.name)
        if (!picked.format) {
          if (isCloudManifest(classifyImportText(file.name, text).kind)) {
            flagWrongImporter('spliit-cloud', file)
            return
          }
          onError(t('Groups.Import.Source.unsupportedFileType'))
          return
        }
        // JSON resolved above via the extension-driven path, and zip bundles
        // via the signature gate; only the single-group CSV entry remains.
        // (A `.zip` name without a zip signature never reaches the bundle
        // flow — it fails content routing above.)
        const parsed =
          picked.format === 'csv' ? runParseSingle(picked.provider, text) : null
        if (!parsed) {
          onError(t('Groups.Import.Source.unsupportedFileType'))
          return
        }
        if (!parsed.ok) {
          onError(parsed.error)
          return
        }
        const guessed = guessGroupNameFromFilename(
          file.name,
          parsed.source.provider,
        )
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
    [
      provider,
      onError,
      onCloudLoaded,
      onLoaded,
      t,
      maxCloudDocumentBytes,
      navigate,
    ],
  )

  useEffect(() => {
    if (!pendingHandoff || provider !== pendingHandoff.target) return
    const file = pendingHandoff.file
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPendingHandoff(null)
      setWrongImporter(null)
      void handleFile(file)
    })
    return () => {
      cancelled = true
    }
  }, [handleFile, pendingHandoff, provider])

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const file = files[0]
      if (file) void handleFile(file)
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

  const showFileImport = cfg.fileImport !== null && !cfg.customTab
  const showDomainSwap = cfg.hasDomainSwap
  const showUrlPaste = cfg.hasUrlPaste
  const copy =
    provider === 'spliit-cloud'
      ? null
      : getProviderCopy(provider as ProviderId, t)

  return (
    <div className="flex flex-col gap-4">
      {retainedCloudBundle && (
        <PageInset>
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertTitle>
              {t('Groups.Import.Source.cloudBundleReadyTitle')}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>
                {t('Groups.Import.Source.cloudBundleReadyDescription')}
              </span>
              <Button
                className="w-fit"
                type="button"
                onClick={retainedCloudBundle.onResume}
              >
                {t('Groups.Import.Source.resumeCloudBundle')}
              </Button>
            </AlertDescription>
          </Alert>
        </PageInset>
      )}
      {wrongImporter && (
        <PageInset>
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertTitle>
              {wrongImporter.messageKey === 'cloud'
                ? t('Groups.Import.Source.wrongImporterCloudTitle')
                : t('Groups.Import.Source.wrongImporterSpliitTitle')}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>
                {wrongImporter.messageKey === 'cloud'
                  ? t('Groups.Import.Source.wrongImporterCloudDescription')
                  : t('Groups.Import.Source.wrongImporterSpliitDescription')}
              </span>
              <Button
                className="w-fit"
                type="button"
                onClick={() => {
                  setPendingHandoff({
                    file: wrongImporter.file,
                    target: wrongImporter.target,
                  })
                  void navigate({
                    to: '/groups/import',
                    search: { source: wrongImporter.target },
                  })
                }}
              >
                {wrongImporter.messageKey === 'cloud'
                  ? t('Groups.Import.Source.openCloudImporter')
                  : t('Groups.Import.Source.openSpliitImporter')}
              </Button>
            </AlertDescription>
          </Alert>
        </PageInset>
      )}
      <Tabs
        value={provider}
        onValueChange={(v) =>
          navigate({
            to: '/groups/import',
            search: { source: v as SourceMode },
          })
        }
      >
        <PageInset>
          <TabsList
            ref={tabsListRef}
            className="w-full justify-start overflow-x-auto sm:w-auto"
          >
            {getTabLabels(t).map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-w-max"
                nativeButton={false}
                render={<Link to="/groups/import" search={{ source: value }} />}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </PageInset>

        {provider === 'spliit-cloud' ? (
          <TabsContent value="spliit-cloud" className="flex flex-col gap-4">
            <PageInset>
              <ProviderDescription
                description={t(
                  'Groups.Import.Source.spliitCloudScopeDescription',
                )}
              />
            </PageInset>
          </TabsContent>
        ) : cfg.customTab ? (
          <TabsContent value={provider}>
            <PageInset>
              <GenericSourceTab
                provider={provider as ProviderId}
                onLoaded={onLoaded}
                onMultiLoaded={(sources) => onMultiLoaded?.(sources)}
                onError={onError}
              />
            </PageInset>
          </TabsContent>
        ) : (
          <TabsContent value={provider} className="flex flex-col gap-4">
            <PageInset>
              <ProviderDescription
                description={copy?.description ?? ''}
                receiptTitle={copy?.receiptTitle ?? undefined}
                receiptDescription={copy?.receiptDescription ?? undefined}
              />
            </PageInset>
            {provider === 'splitwise' && <SplitwiseAnonymizerCard />}
          </TabsContent>
        )}
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
          help={
            provider === 'spliit' ? (
              <ExportGuideTrigger
                trigger={t(
                  'Groups.Import.Source.exportGuide.spliitLinkTrigger',
                )}
                title={t(
                  'Groups.Import.Source.exportGuide.spliitLinkDialogTitle',
                )}
                steps={[
                  {
                    index: 1,
                    text: t('Groups.Import.Source.exportGuide.spliitLinkStep1'),
                  },
                  {
                    index: 2,
                    text: t('Groups.Import.Source.exportGuide.spliitLinkStep2'),
                  },
                ]}
              />
            ) : undefined
          }
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
          onFilesSelected={handleFilesSelected}
          accept={cfg.accept}
          help={<ExportGuideTrigger {...getFileGuide(provider, t)} />}
          labels={
            copy
              ? {
                  dropFile: copy.dropFile,
                  dropFileDescription: copy.dropFileDescription,
                }
              : {
                  dropFile: t('Groups.Import.Source.cloudZipRequired'),
                  dropFileDescription: t(
                    'Groups.Import.Source.spliitCloudScopeDescription',
                  ),
                }
          }
        />
      )}

      {provider === 'spliit' && showFileImport && (
        <PageInset>
          <p className="text-xs text-muted-foreground">
            {t('Groups.Import.Source.csvRecurrenceLimitation')}
          </p>
        </PageInset>
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
  receiptTitle?: string
  receiptDescription?: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{description}</p>
      {receiptTitle && receiptDescription && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>
            <strong>{receiptTitle}</strong> {receiptDescription}
          </p>
        </div>
      )}
    </div>
  )
}

function OrDivider({ label }: { label: string }) {
  return (
    <PageInset>
      <div className="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
        <div className="h-px flex-1 bg-border" />
        <span>{label}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </PageInset>
  )
}
