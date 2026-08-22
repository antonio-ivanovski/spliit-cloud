import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export default function NotFound() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups.NotFound' })
  return (
    <div className="flex flex-col gap-2">
      <p>{t('text')}</p>
      <p>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link to="/" />}
        >
          {t('link')}
        </Button>
      </p>
    </div>
  )
}
