import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  extractSpliitGroupIdFromUrl,
  tryParseSpliitCsv,
  tryParseSpliitExport,
  type NormalizedSource,
} from '@spliit/domain/import'
import { AlertTriangle, Clock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DomainSwapCard } from './domain-swap-card'
import { FileUploadCard } from './file-upload-card'
import { PasteUrlCard } from './paste-url-card'
import { useImportSource } from './use-import-source'

type Props = {
  onLoaded: (source: NormalizedSource) => void
  onError: (message: string) => void
}

type SourceMode = 'spliit' | 'splitwise' | 'tricount' | 'settleup'

export function SourceStep({ onLoaded, onError }: Props) {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<SourceMode>('spliit')
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

  useEffect(() => {
    if (!sourcePreview) return
    if (sourcePreview.kind === 'OK') {
      onLoaded(sourcePreview.source)
      resetPreview()
      return
    }
    if (sourcePreview.kind === 'NOT_FOUND') {
      setUrlError(t('Groups.Import.Source.notFoundUrl'))
      return
    }
    setUrlError(sourcePreview.message)
  }, [sourcePreview, resetPreview, onLoaded, t])
  useEffect(() => {
    if (!sourcePreviewError) return
    setUrlError(sourcePreviewError.message)
  }, [sourcePreviewError])

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const lowerName = file.name.toLowerCase()
        if (lowerName.endsWith('.csv')) {
          const result = tryParseSpliitCsv(text)
          if (!result.ok) {
            onError(result.error)
            return
          }
          onLoaded(result.source)
          return
        }
        // Default: treat as JSON.
        const body = JSON.parse(text)
        const result = tryParseSpliitExport(body)
        if (!result.ok) {
          onError(result.error)
          return
        }
        onLoaded(result.source)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('Groups.Import.Source.fileReadError')
        onError(message)
      }
    },
    [onError, onLoaded, t],
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
      if (provider !== 'spliit') return
      e.preventDefault()
      setIsDragging(true)
    },
    [provider],
  )

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (provider !== 'spliit') return
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [provider, handleFile],
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
    },
    [urlError],
  )

  const tabsListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll the active tab into view on mount so "spliit" isn't clipped on mobile
    const activeTab = tabsListRef.current?.querySelector(
      '[data-state="active"]',
    )
    if (activeTab) {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'start' })
    }
  }, [])

  const spliitDisabled = provider !== 'spliit'

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={provider}
        onValueChange={(v) => setProvider(v as SourceMode)}
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
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t('Groups.Import.Source.spliitDescription')}
            </p>
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p>
                <strong>{t('Groups.Import.Source.receiptWarningTitle')}</strong>{' '}
                {t('Groups.Import.Source.receiptWarningDescription')}
              </p>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="splitwise">
          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('Groups.Import.Source.splitwiseComingTitle')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('Groups.Import.Source.splitwiseComingDescription')}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="tricount">
          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('Groups.Import.Source.tricountComingTitle')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('Groups.Import.Source.tricountComingDescription')}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="settleup">
          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('Groups.Import.Source.settleUpComingTitle')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('Groups.Import.Source.settleUpComingDescription')}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {provider === 'spliit' && (
        <>
          <DomainSwapCard
            title={t('Groups.Import.Source.appToCloudTitle')}
            description={t('Groups.Import.Source.appToCloudDescription')}
            disabled={spliitDisabled}
          />

          <OrDivider label={t('Groups.Import.Source.or')} />

          <PasteUrlCard
            disabled={spliitDisabled}
            isPending={isPreviewLoading}
            url={url}
            urlError={urlError}
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

          <OrDivider label={t('Groups.Import.Source.or')} />

          <FileUploadCard
            disabled={spliitDisabled}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onFileChange={handleFileChange}
            labels={{
              dropFile: t('Groups.Import.Source.dropFile'),
              dropFileDescription: t(
                'Groups.Import.Source.dropFileDescription',
              ),
            }}
          />
        </>
      )}
    </div>
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
