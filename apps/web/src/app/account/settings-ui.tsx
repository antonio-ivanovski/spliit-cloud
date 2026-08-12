import { Loader2, type LucideIcon } from 'lucide-react'
import { type HTMLAttributes, type ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Native control id paired with a settings row / section hash target. */
export function settingsControlId(id: string) {
  return `${id}-control`
}
export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  status,
  footer,
  className,
  children,
}: {
  id?: string
  title: string
  description?: string
  icon?: LucideIcon
  status?: ReactNode
  footer?: ReactNode
  className?: string
  children: ReactNode
}) {
  const headingId = id ? `${id}-heading` : undefined
  return (
    <Card
      id={id}
      aria-labelledby={headingId}
      className={cn('mobile-surface min-w-0 overflow-hidden', className)}
    >
      <header className="flex min-w-0 items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:pt-5 sm:pb-4">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="flex min-w-0 items-center gap-2 text-lg leading-tight font-semibold tracking-tight"
          >
            {Icon ? (
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span className="min-w-0 break-words">{title}</span>
          </h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </header>
      <div className="min-w-0">{children}</div>
      {footer ? (
        <div className="flex min-w-0 flex-col items-end gap-3 border-t border-border/70 px-4 pt-3 pb-4 sm:px-6 sm:pb-6">
          {footer}
        </div>
      ) : null}
    </Card>
  )
}

/**
 * A named subgroup; the tinted header band provides a stronger visual anchor
 * while the rows remain a flat divider-only list inside the outer section.
 */
export function SettingsGroup({
  id,
  title,
  description,
  action,
  beforeRows,
  className,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  action?: ReactNode
  beforeRows?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section
      className={cn('min-w-0 overflow-hidden', className)}
      aria-labelledby={`${id}-heading`}
    >
      <div className="flex min-w-0 items-start justify-between gap-4 border-y border-border/70 bg-muted/30 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 h-5 w-1 shrink-0 rounded-full bg-primary/60"
            />
            <h3
              id={`${id}-heading`}
              className="text-base leading-tight font-semibold tracking-tight break-words text-foreground"
            >
              {title}
            </h3>
          </div>
          {description ? (
            <div className="mt-1 text-sm text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {beforeRows ? (
        <div className="px-4 pt-4 sm:px-6">{beforeRows}</div>
      ) : null}
      {children ? (
        <SettingsList className="border-b border-border/70">
          {children}
        </SettingsList>
      ) : null}
    </section>
  )
}

/**
 * Autosave status; role=status makes the text available to assistive
 * technology.
 */
export function SettingsSaving({ label }: { label: string }) {
  return (
    <output
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      <span className="sr-only">{label}</span>
    </output>
  )
}

/**
 * Plain live status for a section that needs to expose text rather than a
 * spinner.
 */
export function SettingsStatus({ children }: { children: ReactNode }) {
  return (
    <output aria-live="polite" className="text-xs text-muted-foreground">
      {children}
    </output>
  )
}

/** Divider-only row list. The outer section is the only card-like frame. */
export function SettingsList({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('divide-y divide-border/70', className)}>{children}</div>
  )
}

export function SettingsRow({
  id,
  label,
  description,
  control,
  badges,
  layout = 'responsive',
  className,
}: {
  id?: string
  label: string
  description?: ReactNode
  control?: ReactNode
  badges?: ReactNode
  layout?: 'responsive' | 'inline'
  className?: string
}) {
  const titleId = id ? `${id}-label` : undefined
  return (
    <div
      id={id}
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6',
        layout === 'inline' && 'flex-row items-start sm:items-center',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-2">
          <p id={titleId} className="min-w-0 font-medium break-words">
            {label}
          </p>
          {badges}
        </div>
        {description ? (
          <div className="mt-0.5 text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {control ? (
        <div
          className={cn(
            'flex w-full shrink-0 sm:w-auto',
            layout === 'inline' && 'w-auto',
          )}
        >
          {control}
        </div>
      ) : null}
    </div>
  )
}

/** Row variant for a single labelled input/select/switch control. */
export function SettingsFieldRow({
  id,
  label,
  description,
  control,
  layout = 'responsive',
  className,
}: {
  id: string
  label: string
  description?: ReactNode
  control: ReactNode
  layout?: 'responsive' | 'inline'
  className?: string
}) {
  return (
    <div
      id={id}
      className={cn(
        'flex min-w-0 flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6',
        layout === 'inline' && 'flex-row items-start sm:items-center',
        className,
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={settingsControlId(id)}
          className="block min-w-0 font-medium break-words"
        >
          {label}
        </label>
        {description ? (
          <div className="mt-0.5 text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          'flex w-full shrink-0 sm:w-auto',
          layout === 'inline' && 'w-auto',
        )}
      >
        {control}
      </div>
    </div>
  )
}

export function SettingsBadge({
  children,
  className,
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function SettingsSectionSkeleton({
  id,
  title,
  description,
  icon,
  rows = 3,
  className,
}: {
  id?: string
  title: string
  description?: string
  icon?: LucideIcon
  rows?: number
  className?: string
}) {
  return (
    <SettingsSection
      id={id}
      title={title}
      description={description}
      icon={icon}
      className={className}
    >
      <SettingsList className="border-t border-border/70">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="flex min-w-0 flex-col gap-2 px-4 py-3.5 sm:px-6"
          >
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ))}
      </SettingsList>
    </SettingsSection>
  )
}
