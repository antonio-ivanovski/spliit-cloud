import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import * as React from 'react'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

type TooltipContentProps = React.ComponentProps<
  typeof TooltipPrimitive.Popup
> & {
  align?: React.ComponentProps<typeof TooltipPrimitive.Positioner>['align']
  side?: React.ComponentProps<typeof TooltipPrimitive.Positioner>['side']
  sideOffset?: React.ComponentProps<
    typeof TooltipPrimitive.Positioner
  >['sideOffset']
}

function TooltipContent({
  align = 'center',
  side = 'top',
  sideOffset = 6,
  className,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          className={cn(
            'rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
