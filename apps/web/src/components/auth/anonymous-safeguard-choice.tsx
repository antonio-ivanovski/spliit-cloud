import { Fingerprint, KeyRound, Loader2 } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { revokeAnonymousRecovery } from '@/lib/anonymous-recovery'
import {
  addPasskey,
  markPasskeyAsLastUsedLoginMethod,
  notifyPasskeyChanged,
  renamePasskey,
} from '@/lib/passkey'
import { useOnlineStatus } from '@/lib/use-online-status'
import { cn } from '@/lib/utils'

import { AnonymousRecoveryOnboarding } from './anonymous-recovery-onboarding'

type SafeguardMethod = 'link' | 'passkey'

type IconType = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string }
>

function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
        selected
          ? 'border-primary bg-primary'
          : 'border-border bg-background group-hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-background transition-opacity',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  )
}

function ChoiceHeader({
  icon: Icon,
  title,
  helper,
  selected,
}: {
  icon: IconType
  title: string
  helper: string
  selected: boolean
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
          selected
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground group-hover:text-foreground',
        )}
      >
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {helper}
        </p>
      </div>
      <SelectionDot selected={selected} />
    </>
  )
}

/**
 * First-run safeguard choice for a fresh anonymous account: recovery link
 * (primary) or passkey (secondary). Shared by the signup dialog and the
 * `complete-profile` gate so both offer the same options — closing the dialog
 * must not silently drop the passkey alternative.
 *
 * Radio choice cards stay compact (title + helper only); the selected method's
 * setup renders below the group so the cards stay scannable. The host provides
 * the surrounding header; the embedded link setup hides the onboarding's own
 * title to avoid stacked duplicate headings.
 */
export function AnonymousSafeguardChoice({
  displayName,
  onComplete,
}: {
  // The already-saved display name: the ceremony identity for the passkey
  // below. The typed label is only the Spliit-side nickname, renamed after a
  // successful registration.
  displayName: string
  onComplete: () => void | Promise<void>
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.signup',
  })
  const isOnline = useOnlineStatus()
  const [method, setMethod] = useState<SafeguardMethod>('link')
  const [passkeyName, setPasskeyName] = useState('')
  const [passkeyPending, setPasskeyPending] = useState(false)
  const [passkeyError, setPasskeyError] = useState(false)

  async function addPasskeyAndContinue() {
    if (!isOnline) return
    setPasskeyPending(true)
    setPasskeyError(false)
    try {
      // The ceremony always carries the display name as its identity, so the
      // authenticator entry shows it even when the label field is skipped.
      // The label only renames our own row afterwards — best-effort, and
      // skipped when it matches the ceremony name (no-op write).
      const created = await addPasskey(displayName)
      const nickname = passkeyName.trim()
      if (nickname && nickname !== displayName.trim()) {
        await renamePasskey(created.id, nickname).catch(() => {})
      }
      // The account now signs in with a passkey: point the login screen's
      // "Last used" hint at it (the plugin only writes its cookie on
      // sign-in responses, and registration is not one).
      markPasskeyAsLastUsedLoginMethod()
      // Bust the server account cache so the onboarding gate sees the new
      // passkey immediately (plugin writes bypass database hooks).
      await notifyPasskeyChanged()
      // Drop the link created during this setup, if any: it was never
      // acknowledged, so it cannot sign in — but it must not linger as a
      // usable-looking credential either. onlyPending guarantees a saved
      // backup is never removed implicitly. Best effort either way: the
      // passkey is registered and stays manageable in Account settings.
      await revokeAnonymousRecovery({ onlyPending: true }).catch(() => {})
      await onComplete()
    } catch {
      // Stay on the choice step so the user can retry or pick the recovery
      // link instead; the anonymous account already exists.
      setPasskeyError(true)
      setPasskeyPending(false)
    }
  }

  const disabled = passkeyPending || !isOnline

  return (
    <div className="grid gap-3">
      <RadioGroup
        value={method}
        onValueChange={(value) => setMethod(value as SafeguardMethod)}
        aria-label={t('choiceTitle')}
        className="grid gap-3"
      >
        <RadioGroupItem value="link" card disabled={disabled}>
          <ChoiceHeader
            icon={KeyRound}
            title={t('linkTitle')}
            helper={t('linkDescription')}
            selected={method === 'link'}
          />
        </RadioGroupItem>
        <RadioGroupItem value="passkey" card disabled={disabled}>
          <ChoiceHeader
            icon={Fingerprint}
            title={t('passkeyTitle')}
            helper={t('passkeyDescription')}
            selected={method === 'passkey'}
          />
        </RadioGroupItem>
      </RadioGroup>
      {method === 'link' ? (
        <AnonymousRecoveryOnboarding hideHeader onComplete={onComplete} />
      ) : (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="anonymous-passkey-name">
              {t('passkeyNameLabel')}
            </Label>
            <Input
              id="anonymous-passkey-name"
              type="text"
              autoComplete="off"
              maxLength={100}
              placeholder={t('passkeyNamePlaceholder')}
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              disabled={disabled}
            />
          </div>
          <Button
            type="button"
            className="w-full"
            onClick={() => void addPasskeyAndContinue()}
            disabled={disabled}
          >
            {passkeyPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Fingerprint className="me-2 h-4 w-4" aria-hidden="true" />
            )}
            {t('addPasskey')}
          </Button>
          {passkeyError ? (
            <p className="text-sm text-destructive" role="alert">
              {t('passkeyError')}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
