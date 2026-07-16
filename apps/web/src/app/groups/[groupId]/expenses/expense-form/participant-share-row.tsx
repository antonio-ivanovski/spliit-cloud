import { ParticipantAvatar } from '@/components/participant-avatar'
import type { AccountIdentity } from '@/lib/account'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

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
}) {
  return (
    <div
      className={cn(
        'flex w-[calc(100%+3rem)] min-w-0 items-center gap-2 border-t px-4 py-2.5 last-of-type:mb-4! last-of-type:border-b -mx-6',
        checked && 'bg-primary/[0.035]',
        disabled ? 'cursor-default' : 'cursor-pointer',
        className,
      )}
      data-id={dataId}
      onClick={(event) => {
        if (!disabled && event.target === event.currentTarget)
          onCheckedChange(!checked)
      }}
    >
      <button
        type="button"
        className={cn(
          'group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          disabled ? 'cursor-default' : 'cursor-pointer',
        )}
        aria-pressed={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      >
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
          {checked && (
            <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
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
      </button>
      {shareInput && (
        <div className="flex w-fit shrink-0 items-center justify-end">
          {shareInput}
        </div>
      )}
    </div>
  )
}
