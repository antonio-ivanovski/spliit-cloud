import { Check, ChevronsUpDown } from 'lucide-react'

import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  pending?: boolean
}

type Props = {
  participants: Participant[]
  mode: 'single' | 'multi'
  defaultValue?: string
  onValueChange?: (participantId: string) => void
  selectedValues?: string[]
  onValueToggle?: (participantId: string) => void
  multiPlaceholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
}

export function ParticipantSelector({
  participants,
  mode,
  defaultValue,
  onValueChange,
  selectedValues,
  onValueToggle,
  multiPlaceholder,
  disabled = false,
  className,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  const selected =
    participants.find((participant) => participant.id === defaultValue) ??
    participants[0]

  const selectedCount = selectedValues?.length ?? 0

  const triggerLabel =
    mode === 'multi'
      ? selectedCount > 0
        ? t('Expenses.filters.nSelected', { count: selectedCount })
        : (multiPlaceholder ?? '')
      : (selected?.name ?? '')

  const triggerAriaLabel = mode === 'single' ? selected?.name : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={triggerAriaLabel}
          disabled={disabled}
          className={cn(
            'h-9 px-3 text-sm justify-between font-normal',
            className,
            triggerClassName,
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command>
          <CommandInput placeholder={t('Participants.search')} />
          <CommandEmpty>{t('Participants.noParticipant')}</CommandEmpty>
          <div className="max-h-[300px] overflow-y-auto">
            <CommandGroup>
              {participants.map((participant) => {
                const isSelected = selectedValues?.includes(participant.id)
                return (
                  <CommandItem
                    key={participant.id}
                    value={participant.name}
                    onSelect={() => {
                      if (mode === 'multi') {
                        onValueToggle?.(participant.id)
                        return
                      }
                      onValueChange?.(participant.id)
                      setOpen(false)
                    }}
                  >
                    {mode === 'multi' && (
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 shrink-0',
                          isSelected ? '' : 'invisible',
                        )}
                      />
                    )}
                    <ParticipantAvatar
                      participant={participant}
                      size="xs"
                      className="mr-2 shrink-0"
                    />
                    <span className="truncate">{participant.name}</span>
                    {participant.pending && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {t('ExpenseForm.participant.pending')}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
