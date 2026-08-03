/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- popover trigger exposes combobox semantics; popup IDs are managed by the UI primitive. */
import { Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'

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
  singlePlaceholder?: string
  multiPlaceholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  /** Title and action label shown by the mobile multi-select drawer. */
  mobileTitle?: string
  mobileDoneLabel?: string
}

export function ParticipantSelector({
  participants,
  mode,
  defaultValue,
  onValueChange,
  selectedValues,
  onValueToggle,
  singlePlaceholder,
  multiPlaceholder,
  disabled = false,
  className,
  triggerClassName,
  mobileTitle,
  mobileDoneLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const selected = participants.find(
    (participant) => participant.id === defaultValue,
  )

  const selectedCount = selectedValues?.length ?? 0

  const triggerLabel =
    mode === 'multi'
      ? selectedCount > 0
        ? t('Expenses.filters.nSelected', { count: selectedCount })
        : (multiPlaceholder ?? '')
      : (selected?.name ?? singlePlaceholder ?? '')

  const triggerAriaLabel = mode === 'single' ? selected?.name : undefined

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={triggerAriaLabel}
      disabled={disabled}
      className={cn(
        'h-9 justify-between px-3 text-sm font-normal',
        className,
        triggerClassName,
      )}
    >
      {mode === 'single' && selected && (
        <ParticipantAvatar participant={selected} size="xs" className="mr-2" />
      )}
      <span className="truncate">{triggerLabel}</span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  )

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger render={trigger} />
        <DrawerContent className="p-0">
          <DrawerHeader className="pb-2 text-start">
            <DrawerTitle>
              {mobileTitle ?? t('Expenses.filters.paidBy')}
            </DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 overflow-y-auto px-1">
            <ParticipantCommand
              participants={participants}
              mode={mode}
              selectedValues={selectedValues}
              onValueChange={onValueChange}
              onValueToggle={onValueToggle}
              onClose={() => setOpen(false)}
            />
          </div>
          <DrawerFooter className="border-t bg-background pt-3">
            <Button type="button" onClick={() => setOpen(false)}>
              {mobileDoneLabel ?? t('Groups.Import.StepHeader.done')}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <ParticipantCommand
          participants={participants}
          mode={mode}
          selectedValues={selectedValues}
          onValueChange={onValueChange}
          onValueToggle={onValueToggle}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function ParticipantCommand({
  participants,
  mode,
  selectedValues,
  onValueChange,
  onValueToggle,
  onClose,
}: {
  participants: Participant[]
  mode: 'single' | 'multi'
  selectedValues?: string[]
  onValueChange?: (participantId: string) => void
  onValueToggle?: (participantId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const selectedSet = new Set(selectedValues)

  return (
    <Command>
      <CommandInput placeholder={t('Participants.search')} />
      <CommandEmpty>{t('Participants.noParticipant')}</CommandEmpty>
      <div className="max-h-[300px] overflow-y-auto">
        <CommandGroup>
          {participants.map((participant) => {
            const isSelected = selectedSet.has(participant.id)
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
                  onClose()
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
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t('ExpenseForm.participant.pending')}
                  </span>
                )}
              </CommandItem>
            )
          })}
        </CommandGroup>
      </div>
    </Command>
  )
}
