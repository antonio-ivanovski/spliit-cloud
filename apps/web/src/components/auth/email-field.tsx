import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function EmailField(props: {
  value: string
  onChange: (email: string) => void
  disabled?: boolean
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
        disabled={props.disabled}
        required
      />
    </div>
  )
}
