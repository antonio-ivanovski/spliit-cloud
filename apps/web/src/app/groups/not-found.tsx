import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

export default function NotFound() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups.NotFound' })
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
