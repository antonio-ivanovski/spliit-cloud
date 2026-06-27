'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpc } from '@/trpc/client'
import {
  extractSpliitGroupIdFromUrl,
  tryParseSpliitCsv,
  tryParseSpliitExport,
  type NormalizedSource,
} from '@spliit/domain/import'
import { AlertTriangle, Clock, FileUp, Globe } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const previewFromUrl = trpc.groups.importPreview.useMutation()
  const [isDragging, setIsDragging] = useState(false)

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
    [onError, onLoaded],
  )

  const handleUrlSubmit = useCallback(async () => {
    setUrlError(null)
    const sourceGroupId = extractSpliitGroupIdFromUrl(url.trim())
    if (!sourceGroupId) {
      setUrlError(t('Groups.Import.Source.invalidUrl'))
      return
    }
    try {
      const result = await previewFromUrl.mutateAsync({ sourceUrl: url.trim() })
      if (result.kind === 'OK') {
        onLoaded(result.source)
        return
      }
      if (result.kind === 'NOT_FOUND') {
        setUrlError(t('Groups.Import.Source.notFoundUrl'))
        return
      }
      setUrlError(result.message)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('Groups.Import.Source.fetchUrlError')
      setUrlError(message)
    }
  }, [url, previewFromUrl, onLoaded])

  const spliitDisabled = provider !== 'spliit'

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={provider}
        onValueChange={(v) => setProvider(v as SourceMode)}
      >
        <TabsList className="w-full sm:w-auto">
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
          <p className="text-sm text-muted-foreground">
            {t('Groups.Import.Source.spliitDescription')}
          </p>
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
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <label
                className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 transition ${
                  spliitDisabled
                    ? 'pointer-events-none opacity-50'
                    : 'cursor-pointer hover:border-primary/60'
                } ${isDragging ? 'border-primary bg-primary/5' : 'border-muted'}`}
                onDragOver={(e) => {
                  if (spliitDisabled) return
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  if (spliitDisabled) return
                  e.preventDefault()
                  setIsDragging(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) handleFile(file)
                }}
              >
                <FileUp className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t('Groups.Import.Source.dropFile')}
                </span>
                <span className="text-xs text-muted-foreground text-center max-w-md">
                  {t('Groups.Import.Source.dropFileDescription')}
                </span>
                <input
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  className="hidden"
                  disabled={spliitDisabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                    // Reset so the same file can be re-selected.
                    e.target.value = ''
                  }}
                />
              </label>

              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>{t('Groups.Import.Source.or')}</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="spliit-url" className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  {t('Groups.Import.Source.pasteUrl')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('Groups.Import.Source.urlDescription')}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="spliit-url"
                    placeholder={t('Groups.Import.Source.urlPlaceholder')}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={spliitDisabled}
                  />
                  <Button
                    onClick={handleUrlSubmit}
                    disabled={
                      previewFromUrl.isPending ||
                      url.trim().length === 0 ||
                      spliitDisabled
                    }
                    className="sm:w-auto"
                  >
                    {previewFromUrl.isPending
                      ? t('Groups.Import.Source.fetchingButton')
                      : t('Groups.Import.Source.fetchGroupButton')}
                  </Button>
                </div>
                {urlError && (
                  <p className="text-sm text-destructive">{urlError}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>
              <strong>{t('Groups.Import.Source.receiptWarningTitle')}</strong>{' '}
              {t('Groups.Import.Source.receiptWarningDescription')}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
