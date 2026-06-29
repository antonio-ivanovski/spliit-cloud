import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmailField } from './email-field'
import { PasswordChecklist } from './password-checklist'

type Mode = 'sign-in' | 'sign-up'

export function PasswordForm(props: {
  mode: Mode
  email: string
  password: string
  confirmPassword: string
  canSubmit: boolean
  error: string | null
  isPending: boolean
  onEmailChange: (email: string) => void
  onPasswordChange: (password: string) => void
  onConfirmPasswordChange: (password: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <form className="flex flex-col gap-3 pt-4" onSubmit={props.onSubmit}>
      <EmailField value={props.email} onChange={props.onEmailChange} />
      <div className="grid gap-1.5">
        <Label htmlFor="auth-password">{t('password')}</Label>
        <Input
          id="auth-password"
          type="password"
          autoComplete={
            props.mode === 'sign-in' ? 'current-password' : 'new-password'
          }
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          required
        />
      </div>
      {props.mode === 'sign-in' && (
        <Button
          asChild
          variant="link"
          size="sm"
          className="h-auto self-start px-0 py-0"
        >
          <Link
            href="/auth/forgot-password"
            search={
              props.email.trim()
                ? { email: props.email.trim() }
                : { email: undefined }
            }
          >
            {t('forgotPasswordLink')}
          </Link>
        </Button>
      )}
      {props.mode === 'sign-up' && (
        <>
          <PasswordChecklist password={props.password} />
          <div className="grid gap-1.5">
            <Label htmlFor="auth-confirm-password">
              {t('confirmPassword')}
            </Label>
            <Input
              id="auth-confirm-password"
              type="password"
              autoComplete="new-password"
              value={props.confirmPassword}
              onChange={(event) =>
                props.onConfirmPasswordChange(event.target.value)
              }
              required
            />
            {props.confirmPassword.length > 0 &&
              props.password !== props.confirmPassword && (
                <p className="text-xs text-muted-foreground">
                  {t('passwordMismatch')}
                </p>
              )}
          </div>
        </>
      )}
      {props.error && (
        <p className="text-sm text-destructive" role="alert">
          {props.error}
        </p>
      )}
      <Button
        type="submit"
        variant={props.mode === 'sign-in' ? 'default' : 'outline'}
        className="w-full"
        disabled={props.isPending || !props.canSubmit}
      >
        {props.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {props.mode === 'sign-in'
          ? t('signInWithPassword')
          : t('signUpWithPassword')}
      </Button>
    </form>
  )
}
