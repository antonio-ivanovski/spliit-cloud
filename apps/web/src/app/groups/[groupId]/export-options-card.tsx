import {
  FileJson,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { getApiBaseUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'

import { ReportPrintDialog } from './report-print-dialog'

type ExportOptionProps = {
  icon: LucideIcon
  title: string
  purpose: string
  badge: string
  actionLabel: string
  accent?: boolean
  href?: string
  onAction?: () => void
}

function ExportOption({
  icon: Icon,
  title,
  purpose,
  badge,
  actionLabel,
  accent = false,
  href,
  onAction,
}: ExportOptionProps) {
  const action = href ? (
    <Button
      variant={accent ? 'default' : 'secondary'}
      className="h-10 w-full shrink-0 px-3 sm:w-auto"
      render={<Link href={href} target="_blank" rel="noopener noreferrer" />}
    >
      {actionLabel}
    </Button>
  ) : (
    <Button
      type="button"
      variant={accent ? 'default' : 'secondary'}
      className="h-10 w-full shrink-0 px-3 sm:w-auto"
      onClick={onAction}
    >
      {actionLabel}
    </Button>
  )

  return (
    <div
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border px-3 py-2 sm:flex sm:min-h-16 sm:items-center',
        accent &&
          'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/25',
      )}
    >
      <Icon
        className={cn(
          'row-span-2 mt-0.5 h-4 w-4 shrink-0 sm:mt-0',
          accent
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0 sm:flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-sm leading-tight font-semibold">{title}</h3>
          <span
            className={cn(
              'text-[10px] font-semibold tracking-wide text-muted-foreground uppercase',
              accent && 'text-emerald-700 dark:text-emerald-300',
            )}
          >
            {badge}
          </span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{purpose}</p>
      </div>
      <div className="col-span-2 sm:ml-auto">{action}</div>
    </div>
  )
}

/**
 * Settings export card content: three equal-format actions (PDF report, CSV
 * spreadsheet, JSON backup) with explicit buttons instead of the legacy
 * dropdown. CSV/JSON keep their direct download URLs; the print report opens
 * the date dialog.
 */
export function ExportOptionsCard({ groupId }: { groupId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const apiUrl = getApiBaseUrl()
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)

  return (
    <>
      <div data-testid="export-options-grid" className="grid grid-cols-1 gap-2">
        <ExportOption
          icon={FileText}
          title={t('exportPdfTitle')}
          purpose={t('exportPdfPurpose')}
          badge="PDF"
          actionLabel={t('exportPdfAction')}
          accent
          onAction={() => setPdfDialogOpen(true)}
        />
        <ExportOption
          icon={FileSpreadsheet}
          title={t('exportCsvTitle')}
          purpose={t('exportCsvPurpose')}
          badge="CSV"
          actionLabel={t('exportCsvAction')}
          href={`${apiUrl}/groups/${groupId}/expenses/export/csv`}
        />
        <ExportOption
          icon={FileJson}
          title={t('exportJsonTitle')}
          purpose={t('exportJsonPurpose')}
          badge="JSON"
          actionLabel={t('exportJsonAction')}
          href={`${apiUrl}/groups/${groupId}/expenses/export/json`}
        />
      </div>
      <ReportPrintDialog
        groupId={groupId}
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
      />
    </>
  )
}
