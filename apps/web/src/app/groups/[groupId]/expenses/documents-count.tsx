import { Paperclip } from 'lucide-react'

import { useLocale } from '@/i18n/react'
import { formatNumber } from '@/lib/utils'

export function DocumentsCount({ count }: { count: number }) {
  const locale = useLocale()
  if (count === 0) return <></>
  return (
    <div className="flex items-center">
      <Paperclip className="me-1 mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
      <span>{formatNumber(count, locale, { useGrouping: false })}</span>
    </div>
  )
}
