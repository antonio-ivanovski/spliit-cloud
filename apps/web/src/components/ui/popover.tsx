
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Default `modal` so nested popovers (e.g. comboboxes inside Dialog) join the
 * dismissable-layer stack. Without it, Dialog's `hideOthers` /
 * `disableOutsidePointerEvents` make portaled content unclickable and
 * unscrollable on desktop.
 */
function Popover({
  modal = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root modal={modal} {...props} />
}

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    {
      className,
      align = 'center',
      sideOffset = 4,
      onWheel,
      onTouchMove,
      onFocusOutside,
      ...props
    },
    ref,
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'motion-popover z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        onWheel={(event) => {
          // Keep wheel/touch scroll inside the popover when nested in a
          // scroll-locked dialog body (react-remove-scroll).
          event.stopPropagation()
          onWheel?.(event)
        }}
        onTouchMove={(event) => {
          event.stopPropagation()
          onTouchMove?.(event)
        }}
        onFocusOutside={(event) => {
          // cmdk/combobox focus moves between input and list items; don't
          // dismiss the popover for those internal focus shifts.
          event.preventDefault()
          onFocusOutside?.(event)
        }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
)
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverContent, PopoverTrigger }
