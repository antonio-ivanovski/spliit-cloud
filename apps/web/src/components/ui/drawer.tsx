import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Drawer = (props: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root {...props} />
)
Drawer.displayName = 'Drawer'

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Backdrop>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Backdrop>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Backdrop
    ref={ref}
    className={cn(
      'motion-overlay fixed inset-0 z-50 min-h-dvh bg-black/80 opacity-[calc(1-var(--drawer-swipe-progress))] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 supports-[-webkit-touch-callout:none]:absolute',
      className,
    )}
    {...props}
  />
))
DrawerOverlay.displayName = 'DrawerOverlay'

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Popup>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center touch-none">
      <DrawerPrimitive.Popup
        ref={ref}
        className={(state) =>
          cn(
            'motion-drawer relative flex w-full max-h-[calc(100dvh-3rem)] min-h-0 flex-col overflow-hidden rounded-t-[14px] border bg-background pb-[env(safe-area-inset-bottom)] outline-none touch-auto overscroll-contain [transform:translateY(var(--drawer-swipe-movement-y))] transition-[transform,translate,scale,filter,box-shadow] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-out)] data-[nested-drawer-open]:-translate-y-2 data-[nested-drawer-open]:scale-[0.96] data-[nested-drawer-open]:brightness-75 data-[swiping]:select-none data-[starting-style]:[transform:translateY(calc(100%+2px))] data-[ending-style]:[transform:translateY(calc(100%+2px))] data-[ending-style]:duration-[calc(var(--drawer-swipe-strength)*400ms)]',
            state.nested
              ? 'shadow-[0_24px_80px_-20px_rgb(0_0_0/0.65)] ring-1 ring-foreground/20'
              : 'shadow-xl',
            typeof className === 'function' ? className(state) : className,
          )
        }
        {...props}
      >
        <div className="mx-auto mt-3 h-1.5 w-16 shrink-0 rounded-full bg-muted-foreground/35" />
        <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Popup>
    </DrawerPrimitive.Viewport>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('grid gap-1.5 p-4 text-center sm:text-start', className)}
    {...props}
  />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('mt-auto flex flex-col gap-2 p-4', className)}
    {...props}
  />
)
DrawerFooter.displayName = 'DrawerFooter'

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className,
    )}
    {...props}
  />
))
DrawerTitle.displayName = 'DrawerTitle'

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DrawerDescription.displayName = 'DrawerDescription'

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
}
