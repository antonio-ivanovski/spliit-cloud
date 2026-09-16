/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- row background click is intentionally limited to empty space; the nested button is the keyboard control. */
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { ParticipantAvatar } from '@/components/participant-avatar'
import type { AccountIdentity } from '@/lib/account'
import { cn } from '@/lib/utils'

export function ParticipantShareRow({
  participant,
  checked,
  onCheckedChange,
  preview,
  pendingLabel,
  shareInput,
  className,
  disabled,
  dataId,
  focusPriority,
  selectable = true,
}: {
  participant: {
    id: string
    name: string
    pending?: boolean
    unlinked?: boolean
    account?: AccountIdentity | null
  }
  checked: boolean
  onCheckedChange: (next: boolean) => void
  preview?: ReactNode
  pendingLabel?: ReactNode
  shareInput?: ReactNode
  className?: string
  disabled?: boolean
  dataId?: string
  focusPriority?: number
  /**
   * When false the row is purely presentational: same visuals as a checked row
   * but rendered as a div (no button, no check badge, no click). Used for
   * derived splits such as the proportional remainder preview.
   */
  selectable?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 border-t py-2.5 last-of-type:mb-4! last-of-type:border-b',
        checked && 'bg-primary/[0.035]',
        disabled || !selectable ? 'cursor-default' : 'cursor-pointer',
        className,
      )}
      data-id={dataId}
      onClick={(event) => {
        if (selectable && !disabled && event.target === event.currentTarget)
          onCheckedChange(!checked)
      }}
    >
      {selectable ? (
        <button
          data-expense-tab-priority={focusPriority}
          type="button"
          className={cn(
            'group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-start focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden',
            disabled ? 'cursor-default' : 'cursor-pointer',
          )}
          aria-pressed={checked}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
        >
          <RowContent
            participant={participant}
            checked={checked}
            showCheckBadge
            pendingLabel={pendingLabel}
            preview={preview}
          />
        </button>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 cursor-default items-center gap-2 rounded-md text-start">
          <RowContent
            participant={participant}
            checked={checked}
            showCheckBadge={false}
            pendingLabel={pendingLabel}
            preview={preview}
          />
        </div>
      )}
      {shareInput && (
        <div className="flex w-fit shrink-0 items-center justify-end">
          {shareInput}
        </div>
      )}
    </div>
  )
}

function RowContent({
  participant,
  checked,
  showCheckBadge,
  pendingLabel,
  preview,
}: {
  participant: {
    id: string
    name: string
    pending?: boolean
    unlinked?: boolean
    account?: AccountIdentity | null
  }
  checked: boolean
  showCheckBadge: boolean
  pendingLabel?: ReactNode
  preview?: ReactNode
}) {
  return (
    <>
      <span
        className={cn(
          'relative inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
          checked
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground group-hover:bg-muted/70',
        )}
      >
        <ParticipantAvatar
          participant={participant}
          size="sm"
          className="size-8"
        />
        {checked && showCheckBadge && (
          <span className="absolute -end-0.5 -bottom-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
            <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center text-sm font-medium">
          <span className="min-w-0 flex-1 truncate" title={participant.name}>
            {participant.name}
          </span>
          {pendingLabel != null && (
            <span className="shrink-0">{pendingLabel}</span>
          )}
        </span>
        {preview != null && preview !== false && (
          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
            {preview}
          </span>
        )}
      </span>
    </>
  )
}
