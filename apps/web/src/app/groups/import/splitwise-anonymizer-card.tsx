import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { anonymizeSplitwiseCsv } from '@spliit/domain/import'
import { HatGlasses } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SPLITWISE_ISSUES_URL =
  'https://github.com/antonio-ivanovski/spliit-cloud/issues'

type Status =
  { kind: 'idle' } | { kind: 'working' } | { kind: 'error'; message: string }

/** Triggers a browser download for a blob URL and immediately revokes the
 *  handle. Keeping this server-side safe requires no upload — the file lives
 *  as an in-memory Blob the whole time. */
function triggerBrowserDownload(blobUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

export function SplitwiseAnonymizerCard() {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const handleFile = useCallback(
    async (file: File) => {
      setStatus({ kind: 'working' })
      try {
        const text = await file.text()
        const { outputCsv, outputName } = anonymizeSplitwiseCsv(text)
        const blob = new Blob([outputCsv], { type: 'text/csv;charset=utf-8' })
        const blobUrl = URL.createObjectURL(blob)
        triggerBrowserDownload(blobUrl, outputName)
        setStatus({ kind: 'idle' })
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('Groups.Import.Source.splitwiseAnonymizeError')
        setStatus({ kind: 'error', message })
      }
    },
    [t],
  )

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleFile(file)
      e.target.value = ''
    },
    [handleFile],
  )

  return (
    <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30 mt-2">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <HatGlasses className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {t('Groups.Import.Source.splitwiseAnonymizeTitle')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('Groups.Import.Source.splitwiseAnonymizeDescription')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={status.kind === 'working'}
            onClick={() => inputRef.current?.click()}
            className="bg-background"
          >
            <HatGlasses className="mr-2 h-4 w-4" />
            {t('Groups.Import.Source.splitwiseAnonymizeButton')}
          </Button>
          <a
            href={SPLITWISE_ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('Groups.Import.Source.splitwiseAnonymizeIssuesLink')}
          </a>
        </div>

        {status.kind === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onFileChange}
        />
      </CardContent>
    </Card>
  )
}
