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
  showCheckbox = true,
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
  showCheckbox?: boolean
}) {
  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
        'flex min-w-0 w-full flex-wrap gap-y-4 items-center border-t last-of-type:border-b last-of-type:mb-4! -mx-6 px-6 py-3',
        disabled
          ? 'cursor-default [&_button]:cursor-default [&_label]:cursor-default'
          : 'cursor-pointer [&_button]:cursor-pointer [&_label]:cursor-pointer',
        className,
      )}
      data-id={dataId}
      onClick={handleRowClick}
    >
      <FormItem className="min-w-0 flex-1 flex flex-row items-center space-x-3 space-y-0">
        {showCheckbox && (
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
        )}
        <FormLabel className="text-sm font-normal min-w-0 flex-1 flex items-center">
          <ParticipantAvatar
            participant={participant}
            size="sm"
            className="mr-2 shrink-0"
          />
          <span className="min-w-0 truncate">{participant.name}</span>
          {pendingLabel != null && (
            <span className="shrink-0">{pendingLabel}</span>
          )}
          {preview != null && <span className="shrink-0">{preview}</span>}
        </FormLabel>
      </FormItem>
      {shareInput && <div className="flex shrink-0">{shareInput}</div>}
    </div>
  )
}
