import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Effect } from 'effect'
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
  extractSpliitGroupIdFromUrl,
  guessGroupNameFromFilename,
  importErrorToParseResult,
  parseSettleUpCsv,
  parseSpliitCsv,
  type NormalizedSource,
} from '@spliit/domain/import'

import {
  inspectSpliitCloudBundle,
  MAX_CLOUD_DOCUMENT_BYTES,
  type CloudBundleInspection,
} from './cloud-bundle'
import { DomainSwapCard } from './domain-swap-card'
import { ExportGuideTrigger } from './export-guide'
import { FileUploadCard } from './file-upload-card'
import { PasteUrlCard } from './paste-url-card'
import { PROVIDERS, pickParser, type SourceMode } from './source-providers'
import { SplitwiseAnonymizerCard } from './splitwise-anonymizer-card'
import { TricountSourceTab } from './tricount-source-tab'
import type { ImportSourceState } from './use-import-source'

type Props = {
  /** Client-parsed file uploads hand the result directly up. */
  onLoaded: (source: NormalizedSource) => void
  onCloudLoaded?: (source: CloudBundleInspection) => void
  /** Multi-group Tricount dumps hand the selected groups up for queueing. */
  onTricountMultiLoaded?: (sources: NormalizedSource[]) => void
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
  onTricountMultiLoaded,
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
  const [pendingHandoff, setPendingHandoff] = useState<File | null>(null)
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
        const firstBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
        const isZip =
          classifyImportBytes(firstBytes).kind === 'SPLIIT_CLOUD_BUNDLE'

        let text: string | null = null
        const readText = async () => {
          text ??= await file.text()
          return text
        }

        if (provider === 'settleup') {
          // Real exports are UTF-16 with a BOM, which file.text() mangles
          // (UTF-16 NULs become U+0000). Decode from raw bytes first.
          const bytes = new Uint8Array(await file.arrayBuffer())
          const decoded = decodeSettleUpText(bytes)
          if (decoded === null) {
            onError(t('Groups.Import.Source.fileReadError'))
            return
          }
          try {
            const source = Effect.runSync(parseSettleUpCsv(decoded))
            const guessed = guessGroupNameFromFilename(
              file.name,
              source.provider,
            )
            if (guessed) source.name = guessed
            onLoaded(source)
          } catch (error) {
            const result = importErrorToParseResult(error)
            onError(
              result.ok
                ? t('Groups.Import.Source.fileReadError')
                : result.error,
            )
          }
          return
        }

        if (provider === 'spliit' && isZip) {
          setWrongImporter({
            target: 'spliit-cloud',
            file,
            messageKey: 'cloud',
          })
          return
        }

        // Inspect the payload before extension-based parsing so a Cloud
        // manifest renamed to .csv/.txt is still routed to the right tab.
        if (provider === 'spliit' && !isZip) {
          const classification = classifyImportText(
            file.name,
            await readText(),
            (value) => parseSpliitCsv(value),
          )
          if (classification.kind === 'SPLIIT_CLOUD_MANIFEST') {
            setWrongImporter({
              target: 'spliit-cloud',
              file,
              messageKey: 'cloud',
            })
            return
          }
        }

        if (provider === 'spliit-cloud') {
          if (!isZip) {
            const classification = classifyImportText(
              file.name,
              await readText(),
              (value) => parseSpliitCsv(value),
            )
            if (
              classification.kind === 'SPLIIT_APP_JSON' ||
              classification.kind === 'SPLIIT_APP_CSV'
            ) {
              setWrongImporter({
                target: 'spliit',
                file,
                messageKey: 'spliit',
              })
              return
            }
            throw new Error(t('Groups.Import.Source.cloudZipRequired'))
          }
          onCloudLoaded?.(
            await inspectSpliitCloudBundle(file, maxCloudDocumentBytes),
          )
          return
        }

        const picked = pickParser(provider, file.name)
        if (!picked.format) {
          const classification = classifyImportText(
            file.name,
            await readText(),
            (value) => parseSpliitCsv(value),
          )
          if (classification.kind === 'SPLIIT_CLOUD_MANIFEST') {
            setWrongImporter({
              target: 'spliit-cloud',
              file,
              messageKey: 'cloud',
            })
            return
          }
          onError(t('Groups.Import.Source.unsupportedFileType'))
          return
        }
        if (picked.format === 'cloud') {
          onCloudLoaded?.(
            await inspectSpliitCloudBundle(file, maxCloudDocumentBytes),
          )
          return
        }
        const fileText = await readText()
        const parsed =
          picked.format === 'json'
            ? (() => {
                let body: unknown
                try {
                  body = JSON.parse(fileText)
                } catch {
                  return {
                    ok: false as const,
                    error:
                      'This file is not a supported spliit.app JSON export.',
                    code: 'SPLIIT_UNSUPPORTED_SHAPE',
                    params: {},
                  }
                }
                try {
                  return {
                    ok: true as const,
                    source: Effect.runSync(picked.parser(body as never)),
                  }
                } catch (error) {
                  return importErrorToParseResult(error)
                }
              })()
            : (() => {
                try {
                  return {
                    ok: true as const,
                    source: Effect.runSync(picked.parser(fileText as never)),
                  }
                } catch (error) {
                  return importErrorToParseResult(error)
                }
              })()
        if (!parsed.ok) {
          if (picked.format === 'json') {
            try {
              const classification = classifyImportPayload(JSON.parse(fileText))
              if (classification.kind === 'SPLIIT_CLOUD_MANIFEST') {
                setWrongImporter({
                  target: 'spliit-cloud',
                  file,
                  messageKey: 'cloud',
                })
                return
              }
            } catch {
              // Keep the parser's normal malformed-file message below.
            }
          }
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
    [provider, onError, onCloudLoaded, onLoaded, t, maxCloudDocumentBytes],
  )

  useEffect(() => {
    if (!pendingHandoff || provider !== wrongImporter?.target) return
    const file = pendingHandoff
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
  }, [handleFile, pendingHandoff, provider, wrongImporter?.target])

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

  const showFileImport = cfg.fileImport !== null && provider !== 'tricount'
  const showDomainSwap = cfg.hasDomainSwap
  const showUrlPaste = cfg.hasUrlPaste
  const isSpliit = provider === 'spliit'
  const isSplitwise = provider === 'splitwise'
  const isCospend = provider === 'cospend'
  const isSettleUp = provider === 'settleup'
  const isCloud = provider === 'spliit-cloud'

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
                  setPendingHandoff(wrongImporter.file)
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
            <TabsTrigger
              value="spliit"
              className="min-w-max"
              nativeButton={false}
              render={
                <Link to="/groups/import" search={{ source: 'spliit' }} />
              }
            >
              {t('Groups.Import.Source.fromSpliit')}
            </TabsTrigger>
            <TabsTrigger
              value="spliit-cloud"
              className="min-w-max"
              nativeButton={false}
              render={
                <Link to="/groups/import" search={{ source: 'spliit-cloud' }} />
              }
            >
              {t('Groups.Import.Source.fromSpliitCloud')}
            </TabsTrigger>
            <TabsTrigger
              value="splitwise"
              className="min-w-max"
              nativeButton={false}
              render={
                <Link to="/groups/import" search={{ source: 'splitwise' }} />
              }
            >
              {t('Groups.Import.Source.splitwise')}
            </TabsTrigger>
            <TabsTrigger
              value="cospend"
              className="min-w-max"
              nativeButton={false}
              render={
                <Link to="/groups/import" search={{ source: 'cospend' }} />
              }
            >
              {t('Groups.Import.Source.cospend')}
            </TabsTrigger>
            <TabsTrigger
              value="tricount"
              className="min-w-max"
              nativeButton={false}
              render={
                <Link to="/groups/import" search={{ source: 'tricount' }} />
              }
            >
              {t('Groups.Import.Source.tricount')}
            </TabsTrigger>
            <TabsTrigger
              value="settleup"
              className="min-w-max"
              nativeButton={false}
              render={
                <Link to="/groups/import" search={{ source: 'settleup' }} />
              }
            >
              {t('Groups.Import.Source.settleUp')}
            </TabsTrigger>
          </TabsList>
        </PageInset>

        <TabsContent value="spliit">
          <PageInset>
            <ProviderDescription
              description={t('Groups.Import.Source.spliitDescription')}
            />
          </PageInset>
        </TabsContent>
        <TabsContent value="spliit-cloud" className="flex flex-col gap-4">
          <PageInset>
            <ProviderDescription
              description={t(
                'Groups.Import.Source.spliitCloudScopeDescription',
              )}
            />
          </PageInset>
        </TabsContent>
        <TabsContent value="splitwise" className="flex flex-col gap-4">
          <PageInset>
            <ProviderDescription
              description={t('Groups.Import.Source.splitwiseDescription')}
              receiptTitle={t(
                'Groups.Import.Source.receiptWarningTitleSplitwise',
              )}
              receiptDescription={t(
                'Groups.Import.Source.receiptWarningDescriptionSplitwise',
              )}
            />
          </PageInset>
          <SplitwiseAnonymizerCard />
        </TabsContent>
        <TabsContent value="cospend">
          <PageInset>
            <ProviderDescription
              description={t('Groups.Import.Source.cospendDescription')}
              receiptTitle={t(
                'Groups.Import.Source.receiptWarningTitleCospend',
              )}
              receiptDescription={t(
                'Groups.Import.Source.receiptWarningDescriptionCospend',
              )}
            />
          </PageInset>
        </TabsContent>
        <TabsContent value="tricount">
          <PageInset>
            <TricountSourceTab
              onLoaded={onLoaded}
              onMultiLoaded={(sources) => onTricountMultiLoaded?.(sources)}
              onError={onError}
            />
          </PageInset>
        </TabsContent>
        <TabsContent value="settleup">
          <PageInset>
            <ProviderDescription
              description={t('Groups.Import.Source.settleUpDescription')}
              receiptTitle={t(
                'Groups.Import.Source.receiptWarningTitleSettleUp',
              )}
              receiptDescription={t(
                'Groups.Import.Source.receiptWarningDescriptionSettleUp',
              )}
            />
          </PageInset>
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
          help={
            isSpliit ? (
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
          help={<ExportGuideTrigger {...fileGuideProps(provider, t)} />}
          labels={{
            dropFile: t(
              isCloud
                ? 'Groups.Import.Source.cloudZipRequired'
                : isSplitwise
                  ? 'Groups.Import.Source.dropFileSplitwise'
                  : isCospend
                    ? 'Groups.Import.Source.dropFileCospend'
                    : isSettleUp
                      ? 'Groups.Import.Source.dropFileSettleUp'
                      : 'Groups.Import.Source.dropFile',
            ),
            dropFileDescription: t(
              isCloud
                ? 'Groups.Import.Source.spliitCloudScopeDescription'
                : isSplitwise
                  ? 'Groups.Import.Source.dropFileDescriptionSplitwise'
                  : isCospend
                    ? 'Groups.Import.Source.dropFileDescriptionCospend'
                    : isSettleUp
                      ? 'Groups.Import.Source.dropFileDescriptionSettleUp'
                      : 'Groups.Import.Source.dropFileDescription',
            ),
          }}
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

type FileGuideProps = React.ComponentProps<typeof ExportGuideTrigger>

function fileGuideProps(
  provider: SourceMode,
  t: (key: string) => string,
): FileGuideProps {
  switch (provider) {
    case 'spliit':
      return {
        trigger: t('Groups.Import.Source.exportGuide.spliitFileTrigger'),
        title: t('Groups.Import.Source.exportGuide.spliitFileDialogTitle'),
        steps: [
          {
            index: 1,
            text: t('Groups.Import.Source.exportGuide.spliitFileStep1'),
          },
          {
            index: 2,
            text: t('Groups.Import.Source.exportGuide.spliitFileStep2'),
          },
        ],
        artifact: '.json / .csv',
      }
    case 'spliit-cloud':
      return {
        trigger: t('Groups.Import.Source.exportGuide.spliitCloudTrigger'),
        title: t('Groups.Import.Source.exportGuide.spliitCloudTitle'),
        steps: [
          {
            index: 1,
            text: t('Groups.Import.Source.exportGuide.spliitCloudStep1'),
          },
          {
            index: 2,
            text: t('Groups.Import.Source.exportGuide.spliitCloudStep2'),
          },
          {
            index: 3,
            text: t('Groups.Import.Source.exportGuide.spliitCloudStep3'),
          },
        ],
        artifact: '.spliit.zip',
        artifactLabel: t('Groups.Import.Source.exportGuide.artifactLabel'),
        artifactDetail: t(
          'Groups.Import.Source.exportGuide.spliitCloudArtifactDetail',
        ),
        tip: t('Groups.Import.Source.exportGuide.spliitCloudTip'),
      }
    case 'splitwise':
      return {
        trigger: t('Groups.Import.Source.exportGuide.splitwiseTrigger'),
        title: t('Groups.Import.Source.exportGuide.splitwiseTitle'),
        steps: [
          {
            index: 1,
            text: t('Groups.Import.Source.exportGuide.splitwiseStep1'),
          },
          {
            index: 2,
            text: t('Groups.Import.Source.exportGuide.splitwiseStep2'),
          },
          {
            index: 3,
            text: t('Groups.Import.Source.exportGuide.splitwiseStep3'),
          },
        ],
        artifact: '*.csv',
        artifactLabel: t('Groups.Import.Source.exportGuide.artifactLabel'),
        artifactDetail: t(
          'Groups.Import.Source.exportGuide.splitwiseArtifactDetail',
        ),
        tip: t('Groups.Import.Source.exportGuide.splitwiseTip'),
      }
    case 'cospend':
      return {
        trigger: t('Groups.Import.Source.exportGuide.cospendTrigger'),
        title: t('Groups.Import.Source.exportGuide.cospendTitle'),
        steps: [
          {
            index: 1,
            text: t('Groups.Import.Source.exportGuide.cospendStep1'),
          },
          {
            index: 2,
            text: t('Groups.Import.Source.exportGuide.cospendStep2'),
          },
          {
            index: 3,
            text: t('Groups.Import.Source.exportGuide.cospendStep3'),
          },
        ],
        artifact: '*.csv',
        artifactLabel: t('Groups.Import.Source.exportGuide.artifactLabel'),
        artifactDetail: t(
          'Groups.Import.Source.exportGuide.cospendArtifactDetail',
        ),
        tip: t('Groups.Import.Source.exportGuide.cospendTip'),
      }
    case 'settleup':
      return {
        trigger: t('Groups.Import.Source.exportGuide.settleUpTrigger'),
        title: t('Groups.Import.Source.exportGuide.settleUpTitle'),
        steps: [
          {
            index: 1,
            text: t('Groups.Import.Source.exportGuide.settleUpStep1'),
          },
          {
            index: 2,
            text: t('Groups.Import.Source.exportGuide.settleUpStep2'),
          },
          {
            index: 3,
            text: t('Groups.Import.Source.exportGuide.settleUpStep3'),
          },
        ],
        artifact: '*.csv',
        artifactLabel: t('Groups.Import.Source.exportGuide.artifactLabel'),
        artifactDetail: t(
          'Groups.Import.Source.exportGuide.settleUpArtifactDetail',
        ),
        tip: t('Groups.Import.Source.exportGuide.settleUpTip'),
      }
    case 'tricount':
      return { trigger: '', title: '', steps: [] }
  }
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
