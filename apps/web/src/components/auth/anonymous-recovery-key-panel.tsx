import { Check, Copy, Link as LinkIcon, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AnonymousRecoveryKey } from '@/lib/anonymous-recovery'

export function AnonymousRecoveryKeyPanel({
  recovery,
  confirmed,
  onConfirmedChange,
}: {
  recovery: Pick<AnonymousRecoveryKey, 'recoveryUrl'>
  confirmed: boolean
  onConfirmedChange: (confirmed: boolean) => void
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.recovery',
  })
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert className="border-amber-500/35 bg-amber-500/8">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle>{t('warningTitle')}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t('warning')}</p>
          <p>{t('storedDataNote')}</p>
        </AlertDescription>
      </Alert>

      <RecoveryValue
        icon={LinkIcon}
        label={t('linkLabel')}
        value={recovery.recoveryUrl}
        copied={copied}
        copyLabel={t('copyLink')}
        copiedLabel={t('copied')}
        onCopy={() => void copy(recovery.recoveryUrl)}
      />
      {copyFailed ? (
        <p className="text-sm text-destructive" role="alert">
          {t('copyFailed')}
        </p>
      ) : null}

      <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
        <p>{t('howItWorks')}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(value) => onConfirmedChange(value === true)}
          className="mt-0.5"
        />
        <span className="text-sm leading-5 font-medium">
          {t('confirmation')}
        </span>
      </label>
    </div>
  )
}

function RecoveryValue({
  icon: Icon,
  label,
  value,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  icon: typeof LinkIcon
  label: string
  value: string
  copied: boolean
  copyLabel: string
  copiedLabel: string
  onCopy: () => void
}) {
  return (
    <div className="grid gap-2">
      <Label className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </Label>
      <div className="flex gap-2">
        <Input value={value} readOnly className="min-w-0 font-mono text-xs" />
        <Button type="button" variant="outline" onClick={onCopy}>
          {copied ? (
            <Check className="me-2 h-4 w-4" />
          ) : (
            <Copy className="me-2 h-4 w-4" />
          )}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  )
}
