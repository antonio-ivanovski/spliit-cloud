import { Download, FileDown, FileJson } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getApiBaseUrl } from '@/lib/api-url'

export default function ExportButton({
  groupId,
  showLabel = false,
}: {
  groupId: string
  showLabel?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const apiUrl = getApiBaseUrl()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          title={t('export')}
          variant="secondary"
          size={showLabel ? 'default' : 'icon'}
        >
          <Download className="h-4 w-4" />
          {showLabel && <span className="ml-2">{t('export')}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link
            href={`${apiUrl}/groups/${groupId}/expenses/export/json`}
            target="_blank"
            title={t('exportJson')}
          >
            <div className="flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              <p>{t('exportJson')}</p>
            </div>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href={`${apiUrl}/groups/${groupId}/expenses/export/csv`}
            target="_blank"
            title={t('exportCsv')}
          >
            <div className="flex items-center gap-2">
              <FileDown className="h-4 w-4" />
              <p>{t('exportCsv')}</p>
            </div>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
