import type { LucideIcon } from 'lucide-react'
import { Check, MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode, type Ref } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'

const DESKTOP_BREAKPOINT = '(min-width: 640px)'

export type MobileParticipantAction = {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  selected?: boolean
}

/**
 * Keeps low-frequency participant administration compact without sacrificing
 * touch targets: desktop gets the inline controls while phones get one More
 * button and a labeled bottom sheet.
 */
export function ResponsiveParticipantActions({
  label,
  desktopActions,
  mobileActions,
  mobileTriggerRef,
}: {
  label: string
  desktopActions: ReactNode
  mobileActions: MobileParticipantAction[]
  mobileTriggerRef?: Ref<HTMLButtonElement>
}) {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  const [open, setOpen] = useState(false)

  if (isDesktop) return desktopActions

  const selectAction = (action: MobileParticipantAction) => {
    setOpen(false)
    requestAnimationFrame(action.onSelect)
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        render={
          <Button
            ref={mobileTriggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="pb-2 text-start">
          <DrawerTitle>{label}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-1 px-4 pb-4">
          {mobileActions.map((action) => {
            const Icon = action.icon
            return (
              <Button
                key={action.key}
                type="button"
                variant="ghost"
                className={cn(
                  'h-12 justify-start',
                  action.destructive &&
                    'mt-2 text-destructive hover:bg-destructive/10 hover:text-destructive',
                )}
                disabled={action.disabled}
                aria-pressed={action.selected}
                onClick={() => selectAction(action)}
              >
                <Icon data-icon="inline-start" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-start">
                  {action.label}
                </span>
                {action.selected && (
                  <Check data-icon="inline-end" aria-hidden="true" />
                )}
              </Button>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
