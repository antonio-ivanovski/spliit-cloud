import { cn } from '@/lib/utils'
import {
  getPasswordRequirements,
  type PasswordRequirementId,
} from '@spliit/domain/password'
import { Check, Circle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const requirements = useMemo(
    () => getPasswordRequirements(password),
    [password],
  )
  const labels: Record<PasswordRequirementId, string> = {
    minLength: t('passwordRequirements.minLength'),
    uppercase: t('passwordRequirements.uppercase'),
    lowercase: t('passwordRequirements.lowercase'),
    number: t('passwordRequirements.number'),
    symbol: t('passwordRequirements.symbol'),
  }

  return (
    <ul className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
      {requirements.map((requirement) => (
        <li
          key={requirement.id}
          className={cn(
            'flex items-center gap-1.5',
            requirement.isMet && 'text-foreground',
          )}
        >
          {requirement.isMet ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Circle className="h-3 w-3" />
          )}
          <span>{labels[requirement.id]}</span>
        </li>
      ))}
    </ul>
  )
}
