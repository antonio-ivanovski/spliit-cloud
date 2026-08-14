import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { AlertTriangle, Check, Loader2, Pencil, RefreshCw } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { hasRealEmail } from '@/lib/account'
import {
  confirmEmailChange,
  EmailChangeError,
  requestEmailChange,
} from '@/lib/email-change'
import { cn } from '@/lib/utils'

import { SettingsRow, settingsControlId } from './settings-ui'

type Step = 'email' | 'otp'
type Pending = 'send' | 'confirm' | null

const OTP_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60

const ERROR_MESSAGE_KEYS = {
  EMAIL_IN_USE: 'inUse',
  INVALID_EMAIL: 'invalid',
  PLACEHOLDER_EMAIL: 'invalid',
  SAME_EMAIL: 'same',
  GRADUATION_ACK_REQUIRED: 'graduation',
  INVALID_OTP: 'otp',
  OTP_EXPIRED: 'expired',
  EMAIL_RATE_LIMIT_EXCEEDED: 'rateLimited',
  EMAIL_CHANGE_RATE_LIMITED: 'rateLimited',
  EMAIL_SEND_FAILED: 'sendFailed',
} as const

export function AccountEmailSettings({
  email,
  isAnonymous,
  onUpdated,
}: {
  email?: string | null
  isAnonymous?: boolean | null
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountSettings' })
  const { toast } = useToast()
  const realEmail = hasRealEmail(email)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('email')
  const [nextEmail, setNextEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0)
  const pendingRef = useRef<Pending>(null)

  const isAdd = !realEmail
  const needsGraduation = isAdd && isAnonymous === true
  const trimmedEmail = nextEmail.trim()
  const otpInvalid = errorCode === 'INVALID_OTP'

  useEffect(() => {
    if (resendSecondsLeft <= 0) return
    const id = window.setTimeout(
      () => setResendSecondsLeft((seconds) => Math.max(0, seconds - 1)),
      1000,
    )
    return () => window.clearTimeout(id)
  }, [resendSecondsLeft])

  function errorMessage(code: string) {
    const key =
      ERROR_MESSAGE_KEYS[code as keyof typeof ERROR_MESSAGE_KEYS] ?? 'generic'
    return t(`email.errors.${key}`)
  }

  function setBusy(next: Pending) {
    pendingRef.current = next
    setPending(next)
  }

  function openDialog() {
    setErrorCode(null)
    setNextEmail('')
    setOtp('')
    setStep('email')
    setResendSecondsLeft(0)
    setOpen(true)
  }

  function closeDialog() {
    if (pendingRef.current) return
    setOpen(false)
  }

  function goBackToEmail() {
    if (pendingRef.current) return
    setErrorCode(null)
    setOtp('')
    setStep('email')
  }

  async function sendCode() {
    if (pendingRef.current || !trimmedEmail) return
    if (step === 'otp' && resendSecondsLeft > 0) return
    setBusy('send')
    setErrorCode(null)
    try {
      await requestEmailChange({
        email: trimmedEmail,
        ...(needsGraduation ? { acknowledgedGraduation: true } : {}),
      })
      setNextEmail(trimmedEmail)
      setOtp('')
      setResendSecondsLeft(RESEND_COOLDOWN_SECONDS)
      setStep('otp')
    } catch (err) {
      const code =
        err instanceof EmailChangeError ? err.code : 'EMAIL_CHANGE_FAILED'
      setErrorCode(code)
    } finally {
      setBusy(null)
    }
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault()
    await sendCode()
  }

  async function handleConfirm(event: FormEvent) {
    event.preventDefault()
    if (pendingRef.current || otp.length !== OTP_LENGTH) return
    setBusy('confirm')
    setErrorCode(null)
    try {
      await confirmEmailChange({ email: trimmedEmail, otp })
      await onUpdated()
      toast({
        description: isAdd ? t('email.added') : t('email.changed'),
      })
      setOpen(false)
    } catch (err) {
      const code =
        err instanceof EmailChangeError ? err.code : 'EMAIL_CHANGE_FAILED'
      setErrorCode(code)
    } finally {
      setBusy(null)
    }
  }

  const sending = pending === 'send'
  const confirming = pending === 'confirm'
  const busy = pending !== null

  return (
    <>
      <SettingsRow
        id="account-settings-email"
        label={t('emailLabel')}
        description={realEmail ? t('email.changeHelp') : t('email.addHelp')}
        control={
          <div className="flex w-full min-w-0 items-center gap-2 sm:justify-end">
            <span
              id={settingsControlId('account-settings-email')}
              className={cn(
                'min-w-0 flex-1 truncate text-sm sm:flex-none sm:text-end',
                realEmail ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {realEmail ? email : t('email.empty')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={openDialog}
            >
              <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
              {realEmail ? t('email.change') : t('email.add')}
            </Button>
          </div>
        }
      />

      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) closeDialog()
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          {step === 'email' ? (
            <form
              className="contents"
              onSubmit={(event) => void handleEmailSubmit(event)}
            >
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {isAdd ? t('email.addTitle') : t('email.changeTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {isAdd
                    ? t('email.addDescription')
                    : t('email.changeDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-3">
                {needsGraduation ? (
                  <Alert
                    className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
                    aria-live="polite"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertTitle>{t('email.graduationTitle')}</AlertTitle>
                    <AlertDescription>
                      {t('email.graduationBody')}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="account-email-next">
                    {t('email.newLabel')}
                  </Label>
                  <Input
                    id="account-email-next"
                    type="email"
                    autoComplete="email"
                    value={nextEmail}
                    onChange={(event) => setNextEmail(event.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
                {errorCode ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage(errorCode)}
                  </p>
                ) : null}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={busy}
                >
                  {t('email.cancel')}
                </Button>
                <Button type="submit" disabled={busy || !trimmedEmail}>
                  {sending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {sending ? t('email.sending') : t('email.sendCode')}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          ) : (
            <form
              className="contents"
              onSubmit={(event) => void handleConfirm(event)}
            >
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('email.codeTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t('email.sent')}</span>
                  <span>
                    {t('email.codeDescription', { email: trimmedEmail })}
                  </span>
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="account-email-otp">
                    {t('email.codeLabel')}
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 tabular-nums"
                    onClick={() => void sendCode()}
                    disabled={busy || resendSecondsLeft > 0}
                  >
                    {sending ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
                    )}
                    {resendSecondsLeft > 0
                      ? t('email.resendIn', { seconds: resendSecondsLeft })
                      : t('email.resend')}
                  </Button>
                </div>
                <InputOTP
                  id="account-email-otp"
                  maxLength={OTP_LENGTH}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(value) => {
                    setOtp(value)
                    if (errorCode === 'INVALID_OTP') setErrorCode(null)
                  }}
                  disabled={busy}
                  containerClassName="justify-center gap-2 **:data-[slot=input-otp-slot]:h-12 **:data-[slot=input-otp-slot]:w-10 **:data-[slot=input-otp-slot]:text-lg sm:**:data-[slot=input-otp-slot]:w-11"
                  required
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} aria-invalid={otpInvalid} />
                    <InputOTPSlot index={1} aria-invalid={otpInvalid} />
                    <InputOTPSlot index={2} aria-invalid={otpInvalid} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} aria-invalid={otpInvalid} />
                    <InputOTPSlot index={4} aria-invalid={otpInvalid} />
                    <InputOTPSlot index={5} aria-invalid={otpInvalid} />
                  </InputOTPGroup>
                </InputOTP>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto self-start p-0 text-muted-foreground"
                  onClick={goBackToEmail}
                  disabled={busy}
                >
                  {t('email.useDifferent')}
                </Button>
                {errorCode ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage(errorCode)}
                  </p>
                ) : null}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={busy}
                >
                  {t('email.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={busy || otp.length !== OTP_LENGTH}
                >
                  {confirming ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {confirming ? t('email.verifying') : t('email.verify')}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
