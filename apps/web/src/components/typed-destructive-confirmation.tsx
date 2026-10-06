import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DestructiveConfirmationKind } from '@spliit/domain/account-preferences'

export type { DestructiveConfirmationKind }

export const DESTRUCTIVE_CONFIRMATION_SETTINGS_HASH =
  'account-preference-destructive-confirmation-level'

/**
 * Footnote for typed expense-delete dialogs (strict mode only) offering the
 * plain confirmation dialog as an alternative. Deep-links to the setting so it
 * can be changed without hunting through account settings.
 */
export function DestructiveConfirmationSettingsNote() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'Common.destructiveConfirmation',
  })
  return (
    <p className="text-xs text-muted-foreground">
      {t('settingsNoteLead')}{' '}
      <a
        href={`/account/settings#${DESTRUCTIVE_CONFIRMATION_SETTINGS_HASH}`}
        className="underline underline-offset-2"
      >
        {t('settingsNoteLink')}
      </a>{' '}
      {t('settingsNoteTail')}
    </p>
  )
}

type Props = {
  kind: DestructiveConfirmationKind
  targetName: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  onConfirm?: () => void | Promise<void>
  id?: string
}

export function isTypedConfirmationMatch(value: string, targetName: string) {
  return targetName.length > 0 && value === targetName
}

/**
 * Keeps a confirmation value scoped to a dialog/target identity. Deriving the
 * visible value from the identity avoids an effect-driven state reset when a
 * dialog closes or switches to another destructive target.
 */
export function useTypedConfirmationValue(resetKey: string) {
  const [state, setState] = useState({ resetKey, value: '' })
  const value = state.resetKey === resetKey ? state.value : ''
  const setValue = (nextValue: string) =>
    setState({ resetKey, value: nextValue })

  return [value, setValue] as const
}

export function TypedDestructiveConfirmation({
  kind,
  targetName,
  value,
  onValueChange,
  disabled = false,
  onConfirm,
  id,
}: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'Common.destructiveConfirmation',
  })
  const generatedId = useId()
  const inputId = id ?? `destructive-confirmation-${generatedId}`
  const promptId = `${inputId}-prompt`
  const errorId = `${inputId}-error`
  const matches = isTypedConfirmationMatch(value, targetName)
  const hasMismatch = value.length > 0 && !matches

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !matches || disabled || !onConfirm) return
    event.preventDefault()
    // Match the AsyncButton behavior: callers surface mutation failures in
    // their own UI, while an Enter keypress must not create an unhandled
    // rejected promise.
    void Promise.resolve()
      .then(onConfirm)
      .catch(() => undefined)
  }

  return (
    <div className="space-y-2.5">
      <p id={promptId} className="text-sm leading-6 text-muted-foreground">
        <Trans
          i18nKey={`Common.destructiveConfirmation.prompt.${kind}`}
          values={{ name: targetName }}
          components={{
            target: (
              <InlineConfirmationTarget
                targetName={targetName}
                copyLabel={t('copyName')}
                copiedLabel={t('copied')}
              />
            ),
          }}
        />
      </p>
      <label htmlFor={inputId} className="sr-only">
        {t('inputLabel')}
      </label>
      <Input
        id={inputId}
        className={cn(
          'h-9',
          hasMismatch && 'border-destructive focus-visible:ring-destructive/20',
        )}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={t('placeholder', { name: targetName })}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={hasMismatch || undefined}
        aria-describedby={hasMismatch ? `${promptId} ${errorId}` : promptId}
      />
      {hasMismatch ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {t('mismatch', { name: targetName })}
        </p>
      ) : null}
    </div>
  )
}

function InlineConfirmationTarget({
  children,
  targetName,
  copyLabel,
  copiedLabel,
}: {
  children?: ReactNode
  targetName: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-dashed border-muted-foreground/40 bg-muted/25 py-0.5 ps-2 pe-0.5 align-middle text-foreground">
      <span className="min-w-0 leading-5 font-medium break-words whitespace-pre-wrap select-text">
        {children}
      </span>
      <CopyButton
        key={targetName}
        text={targetName}
        ariaLabel={copyLabel}
        copiedLabel={copiedLabel}
        variant="ghost"
        className="h-6 w-6 shrink-0 rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
      />
    </span>
  )
}
