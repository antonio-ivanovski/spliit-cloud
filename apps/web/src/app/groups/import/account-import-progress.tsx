import { useTranslation } from 'react-i18next'

type Props = {
  phase: 'setup' | 'active'
  current?: number
  total: number
  selected?: number
  groupName?: string
}

/** Wizard-chrome context for an account backup and its sequential group queue. */
export function AccountImportProgress({
  phase,
  current = 0,
  total,
  selected = 0,
  groupName,
}: Props) {
  const { t } = useTranslation()
  const value = Math.min(Math.max(current, 0), total)
  const progressLabel =
    phase === 'active' && groupName
      ? t('Groups.Import.Cloud.accountProgress', {
          current: value,
          total,
          name: groupName,
        })
      : null
  const setupLabel = t('AccountSettings.export.selectedCount', {
    selected,
    total,
  })

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          {t('Groups.Import.Cloud.accountTitle')}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {progressLabel ?? setupLabel}
        </span>
      </div>
      {phase === 'active' && progressLabel ? (
        <progress
          className="h-1.5 w-full overflow-hidden rounded-full bg-border/70 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-border/70 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
          value={value}
          max={total}
          aria-valuetext={progressLabel}
          aria-label={progressLabel}
        />
      ) : (
        <div
          className="h-1.5 w-full rounded-full bg-border/40"
          aria-hidden="true"
        />
      )}
      {phase === 'setup' ? (
        <p className="text-xs text-muted-foreground">
          {t('Groups.Import.Source.cloudBundleReadyDescription')}
        </p>
      ) : null}
    </div>
  )
}
