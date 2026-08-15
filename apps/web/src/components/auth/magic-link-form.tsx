import { Loader2, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { EmailField } from './email-field'

export function MagicLinkForm(props: {
  email: string
  error: string | null
  isPending: boolean
  disabled?: boolean
  onEmailChange: (email: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const actionsDisabled = Boolean(props.disabled)
  return (
    <form className="flex flex-col gap-3 pt-4" onSubmit={props.onSubmit}>
      <EmailField
        value={props.email}
        onChange={props.onEmailChange}
        disabled={actionsDisabled}
      />
      {props.error && (
        <p className="text-sm text-destructive" role="alert">
          {props.error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={actionsDisabled || props.isPending || !props.email.trim()}
      >
        {props.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
        <Mail className="me-2 h-4 w-4" />
        {t('sendMagicLink')}
      </Button>
    </form>
  )
}
