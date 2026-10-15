import { Effect } from 'effect'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PageInset } from '@/components/layout/page-shell'
import {
  extractTricountToken,
  importErrorToParseResult,
  parseTricountCsv,
  type NormalizedSource,
} from '@spliit/domain/import'

import { ExportGuideTrigger } from './export-guide'
import { FileUploadCard } from './file-upload-card'
import { PasteUrlCard } from './paste-url-card'
import { TricountGroupSetup } from './tricount-group-setup'
import { useTricountSource } from './use-import-source'

type Props = {
  onLoaded: (source: NormalizedSource) => void
  onMultiLoaded: (sources: NormalizedSource[]) => void
  onError: (message: string) => void
}

/**
 * Tricount source tab: GDPR CSV upload with multi-group routing.
 *
 * Single-group dumps resolve straight into the wizard via `onLoaded`;
 * multi-group dumps lift into `onMultiLoaded` so the wizard can show the group
 * picker and queue each group through the standard flow.
 */
export function TricountSourceTab({ onLoaded, onMultiLoaded, onError }: Props) {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [multiSources, setMultiSources] = useState<NormalizedSource[] | null>(
    null,
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const {
    data: preview,
    isLoading: isPreviewLoading,
    error: previewError,
    submit: submitPreview,
    reset: resetPreview,
  } = useTricountSource()

  // Server fetch completion feeds the same single/multi routing as files.
  useEffect(() => {
    if (preview?.kind === 'OK') {
      onLoaded(preview.source)
      resetPreview()
    }
  }, [preview, onLoaded, resetPreview])

  const serverError =
    preview && preview.kind !== 'OK'
      ? preview.kind === 'NOT_FOUND'
        ? t('Groups.Import.Source.tricountNotFound')
        : preview.message
      : previewError
        ? previewError.message
        : null
  const displayedUrlError = urlError ?? serverError

  const handleUrlSubmit = useCallback(() => {
    setUrlError(null)
    if (!extractTricountToken(url)) {
      setUrlError(t('Groups.Import.Source.tricountInvalidUrl'))
      return
    }
    submitPreview(url.trim())
  }, [url, submitPreview, t])

  const handleUrlChange = useCallback(
    (value: string) => {
      setUrl(value)
      if (urlError) setUrlError(null)
      if (preview || previewError) resetPreview()
    },
    [urlError, preview, previewError, resetPreview],
  )

  const handleFile = useCallback(
    async (file: File) => {
      const text = await file.text()
      let sources: NormalizedSource[]
      try {
        sources = Effect.runSync(parseTricountCsv(text))
      } catch (error) {
        const result = importErrorToParseResult(error)
        onError(result.ok ? 'Invalid import' : result.error)
        return
      }
      if (sources.length === 1) {
        onLoaded(sources[0]!)
        return
      }
      setMultiSources(sources)
      setSelectedIds(sources.map((s) => s.sourceGroupId))
    },
    [onLoaded, onError],
  )

  const handleToggle = useCallback((sourceId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, sourceId])]
        : current.filter((id) => id !== sourceId),
    )
  }, [])

  const handleContinue = useCallback(() => {
    if (!multiSources) return
    const selected = multiSources.filter((s) =>
      selectedIds.includes(s.sourceGroupId),
    )
    if (selected.length === 1) {
      setMultiSources(null)
      onLoaded(selected[0]!)
      return
    }
    onMultiLoaded(selected)
  }, [multiSources, selectedIds, onLoaded, onMultiLoaded])

  if (multiSources) {
    return (
      <PageInset>
        <TricountGroupSetup
          sources={multiSources}
          selectedSourceIds={new Set(selectedIds)}
          isApplying={false}
          error={null}
          onToggleSource={handleToggle}
          onContinue={handleContinue}
          onChooseAnother={() => setMultiSources(null)}
        />
      </PageInset>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageInset>
        <p className="text-sm text-muted-foreground">
          {t('Groups.Import.Source.exportGuide.tricountDescription')}
        </p>
      </PageInset>
      <PasteUrlCard
        disabled={false}
        isPending={isPreviewLoading}
        url={url}
        urlError={displayedUrlError}
        onUrlChange={handleUrlChange}
        onSubmit={handleUrlSubmit}
        help={
          <ExportGuideTrigger
            trigger={t('Groups.Import.Source.exportGuide.tricountLinkTrigger')}
            title={t(
              'Groups.Import.Source.exportGuide.tricountLinkDialogTitle',
            )}
            steps={[
              {
                index: 1,
                text: t('Groups.Import.Source.exportGuide.tricountLinkStep1'),
              },
              {
                index: 2,
                text: t('Groups.Import.Source.exportGuide.tricountLinkStep2'),
              },
            ]}
          />
        }
        labels={{
          pasteUrl: t('Groups.Import.Source.tricountPasteUrl'),
          urlDescription: t('Groups.Import.Source.tricountUrlDescription'),
          urlPlaceholder: t('Groups.Import.Source.tricountUrlPlaceholder'),
          fetchGroupButton: t('Groups.Import.Source.fetchGroupButton'),
          fetchingButton: t('Groups.Import.Source.fetchingButton'),
        }}
      />
      <PageInset>
        <div className="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
          <div className="h-px flex-1 bg-border" />
          <span>{t('Groups.Import.Source.or')}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      </PageInset>
      <FileUploadCard
        disabled={false}
        isDragging={isDragging}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) void handleFile(file)
        }}
        onFilesSelected={(files) => {
          const file = files[0]
          if (file) void handleFile(file)
        }}
        accept=".csv,text/csv"
        help={
          <ExportGuideTrigger
            trigger={t('Groups.Import.Source.exportGuide.tricountGdprTrigger')}
            title={t('Groups.Import.Source.exportGuide.tricountGdprTitle')}
            steps={[
              {
                index: 1,
                text: t('Groups.Import.Source.exportGuide.tricountGdprStep1'),
              },
              {
                index: 2,
                text: t('Groups.Import.Source.exportGuide.tricountGdprStep2'),
              },
              {
                index: 3,
                text: t('Groups.Import.Source.exportGuide.tricountGdprStep3'),
              },
            ]}
            artifact="*.csv"
          />
        }
        labels={{
          dropFile: t('Groups.Import.Source.dropFileTricount'),
          dropFileDescription: t(
            'Groups.Import.Source.dropFileDescriptionTricount',
          ),
        }}
      />
    </div>
  )
}
