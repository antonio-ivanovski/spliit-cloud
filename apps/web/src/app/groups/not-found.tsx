import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n/react'

export default function NotFound() {
  const t = useTranslations('Groups.NotFound')
  return (
    <div className="flex flex-col gap-2">
      <p>{t('text')}</p>
      <p>
        <Button asChild variant="secondary">
          <Link href="/groups">{t('link')}</Link>
        </Button>
      </p>
    </div>
  )
}
