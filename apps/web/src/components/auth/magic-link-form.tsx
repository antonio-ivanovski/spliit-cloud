import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function MagicLinkForm(props: {
  email: string
  error: string | null
  isPending: boolean
  onEmailChange: (email: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <form className="flex flex-col gap-3 pt-4" onSubmit={props.onSubmit}>
      <EmailField value={props.email} onChange={props.onEmailChange} />
      {props.error && (
        <p className="text-sm text-destructive" role="alert">
          {props.error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={props.isPending || !props.email.trim()}
      >
        {props.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        <Mail className="w-4 h-4 mr-2" />
        {t('sendMagicLink')}
      </Button>
    </form>
  )
}

function EmailField(props: {
  value: string
  onChange: (email: string) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="auth-email">{t('email')}</Label>
      <Input
        id="auth-email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required
      />
    </div>
  )
}
