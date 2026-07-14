import { ParticipantAvatar } from '@/components/participant-avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormItem, FormLabel } from '@/components/ui/form'
import type { AccountIdentity } from '@/lib/account'
import { cn } from '@/lib/utils'
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
  const hasPreview = preview != null && preview !== false

  const handleRowClick = (
    e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (disabled) return
    const target = e.target as HTMLElement
    if (
      target.closest('button, input, label, [role="button"], textarea, select')
    ) {
      return
    }
    onCheckedChange(!checked)
  }

  return (
    <div
      className={cn(
        'flex w-[calc(100%+3rem)] min-w-0 items-center gap-3 border-t px-6 py-3 last-of-type:mb-4! last-of-type:border-b -mx-6',
        disabled
          ? 'cursor-default [&_button]:cursor-default [&_label]:cursor-default'
          : 'cursor-pointer [&_button]:cursor-pointer [&_label]:cursor-pointer',
        className,
      )}
      data-id={dataId}
      role="checkbox"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          handleRowClick(e)
        }
      }}
    >
      <FormItem className="grid w-full min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 space-y-0 md:flex md:flex-row md:items-center md:gap-3">
        <FormControl>
          <Checkbox
            checked={checked}
            onCheckedChange={(next) => {
              if (disabled) return
              onCheckedChange(next as boolean)
            }}
            disabled={disabled}
          />
        </FormControl>
        <FormLabel className="col-start-2 row-start-1 min-w-0 flex flex-1 items-center text-sm font-normal md:col-auto md:row-auto">
          <ParticipantAvatar
            participant={participant}
            size="sm"
            className="mr-2 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate" title={participant.name}>
            {participant.name}
          </span>
          {pendingLabel != null && (
            <span className="shrink-0">{pendingLabel}</span>
          )}
        </FormLabel>
        {hasPreview && (
          <span className="col-start-2 row-start-2 min-w-0 pl-10 md:col-auto md:row-auto md:shrink-0 md:pl-0">
            {preview}
          </span>
        )}
        {shareInput && (
          <div className="col-start-3 row-start-1 ml-0 flex w-fit shrink-0 justify-self-end md:ml-auto">
            {shareInput}
          </div>
        )}
      </FormItem>
    </div>
  )
}
