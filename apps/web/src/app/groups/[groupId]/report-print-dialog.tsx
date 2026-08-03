import { Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'

function isValidRange(from: string, to: string): boolean {
  return from !== '' && to !== '' && from <= to
}

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function ReportPrintDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { toast } = useToast()
  const timeZone = getBrowserTimeZone()
  const bounds = trpc.groups.reports.bounds.useQuery(
    { groupId, timeZone },
    { enabled: open },
  )
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [opening, setOpening] = useState(false)

  // oxlint-disable react/react-compiler -- initialize the date fields after the asynchronous bounds query resolves.
  useEffect(() => {
    if (!open || !bounds.data) return
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- bounds arrive asynchronously and initialize otherwise uncontrolled date fields without overwriting user edits.
    setFrom((current) => current || bounds.data!.from)
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- bounds arrive asynchronously and initialize otherwise uncontrolled date fields without overwriting user edits.
    setTo((current) => current || bounds.data!.to)
  }, [open, bounds.data])
  // oxlint-enable react/react-compiler

  const rangeInvalid = from !== '' && to !== '' && from > to
  const submitDisabled = opening || !isValidRange(from, to) || !bounds.data

  function handleOpenChange(next: boolean) {
    if (opening) return
    onOpenChange(next)
  }

  function handleOpenPrintReport(event: FormEvent) {
    event.preventDefault()
    if (!isValidRange(from, to) || opening) return

    setOpening(true)
    const params = new URLSearchParams({ from, to })
    const reportUrl = `/groups/${encodeURIComponent(groupId)}/expenses/print?${params.toString()}`
    const reportWindow = window.open(reportUrl, '_blank')

    if (!reportWindow) {
      toast({
        description: t('exportPdfError'),
        variant: 'destructive',
      })
      setOpening(false)
      return
    }

    // The report is same-origin, so we can clear the opener after opening the
    // tab instead of using the `noopener` feature that makes `window.open`
    // return null in some browsers even when the tab was created.
    reportWindow.opener = null

    toast({ description: t('exportPdfSuccess') })
    onOpenChange(false)
    setOpening(false)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('exportPdfDialogTitle')}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form id="report-print-form" onSubmit={handleOpenPrintReport}>
          <ResponsiveDialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('exportPdfDialogDescription')}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-print-from">
                  {t('exportPdfFromLabel')}
                </Label>
                <Input
                  id="report-print-from"
                  type="date"
                  required
                  value={from}
                  max={to || undefined}
                  aria-invalid={rangeInvalid}
                  aria-describedby={
                    rangeInvalid ? 'report-print-range-error' : undefined
                  }
                  onChange={(event) => setFrom(event.target.value)}
                  className={cn(
                    'date-base',
                    rangeInvalid && 'border-destructive',
                  )}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-print-to">{t('exportPdfToLabel')}</Label>
                <Input
                  id="report-print-to"
                  type="date"
                  required
                  value={to}
                  min={from || undefined}
                  aria-invalid={rangeInvalid}
                  aria-describedby={
                    rangeInvalid ? 'report-print-range-error' : undefined
                  }
                  onChange={(event) => setTo(event.target.value)}
                  className={cn(
                    'date-base',
                    rangeInvalid && 'border-destructive',
                  )}
                />
              </div>
            </div>
            {rangeInvalid && (
              <p
                id="report-print-range-error"
                className="text-sm text-destructive"
              >
                {t('exportPdfInvalidRange')}
              </p>
            )}
            {bounds.isError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <span>{t('exportPdfError')}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-destructive hover:text-destructive"
                  onClick={() => void bounds.refetch()}
                >
                  {t('exportPdfRetryBounds')}
                </Button>
              </div>
            )}
          </ResponsiveDialogBody>
        </form>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={opening}
            onClick={() => onOpenChange(false)}
          >
            {t('exportPdfCancel')}
          </Button>
          <Button
            type="submit"
            form="report-print-form"
            disabled={submitDisabled}
          >
            {opening && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {opening ? t('exportPdfGenerating') : t('exportPdfGenerate')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
