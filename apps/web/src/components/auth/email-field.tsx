import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from 'react-i18next'

export function EmailField(props: {
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
