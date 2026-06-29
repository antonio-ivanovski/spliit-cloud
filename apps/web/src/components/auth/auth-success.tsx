import { Button } from '@/components/ui/button'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function AuthSuccess(props: {
  email: string
  message: string
  onReset: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center flex flex-col gap-3">
      <Mail className="w-6 h-6 mx-auto text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{props.message}</p>
      {props.email.trim() && (
        <p className="text-sm font-medium">{props.email.trim()}</p>
      )}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="mx-auto h-auto py-0"
        onClick={props.onReset}
      >
        {t('useDifferentEmail')}
      </Button>
    </div>
  )
}
