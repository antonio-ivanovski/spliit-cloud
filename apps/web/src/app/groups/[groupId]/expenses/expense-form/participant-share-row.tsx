import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormItem, FormLabel } from '@/components/ui/form'
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
        'flex flex-wrap gap-y-4 items-center border-t last-of-type:border-b last-of-type:!mb-4 -mx-6 px-6 py-3',
        disabled
          ? 'cursor-default [&_button]:cursor-default [&_label]:cursor-default'
          : 'cursor-pointer [&_button]:cursor-pointer [&_label]:cursor-pointer',
        className,
      )}
      data-id={dataId}
      onClick={handleRowClick}
    >
      <FormItem className="flex-1 flex flex-row items-center space-x-3 space-y-0">
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
        <FormLabel className="text-sm font-normal flex-1">
          {participant.name}
          {pendingLabel}
          {preview}
        </FormLabel>
      </FormItem>
      {shareInput && <div className="flex">{shareInput}</div>}
    </div>
  )
}
