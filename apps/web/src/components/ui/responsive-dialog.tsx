import * as React from 'react'

import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer'

/**
 * Responsive dialog primitive: renders a centered modal on desktop and a
 * bottom drawer on mobile. App-level action dialogs (confirmations, forms,
 * pickers) must use this so the same interaction behaves consistently on
 * phone and desktop.
 *
 * Breakpoint aligns with Tailwind `sm` (640px). Direct imports from
 * `./dialog` or `./drawer` should be reserved for full-screen viewers
 * (e.g. document preview), command palette internals, or this file.
 */
const DESKTOP_BREAKPOINT = '(min-width: 640px)'

/**
 * Shared media-query result propagated through context so every sub-component
 * renders the same primitive (Dialog vs Drawer) in the same render cycle.
 * Prevents "DialogPortal must be used within Dialog" crashes on resize.
 */
type ResponsiveDialogSurface = 'dialog' | 'drawer'

const ResponsiveDialogContext = React.createContext<
  ResponsiveDialogSurface | undefined
>(undefined)

function useResponsiveDialogSurface() {
  return React.useContext(ResponsiveDialogContext)
}

function useResponsiveDialogIsDesktop() {
  return useResponsiveDialogSurface() !== 'drawer'
}

type ResponsiveDialogProps = React.ComponentProps<typeof Dialog>

/**
 * Base UI types Dialog and Drawer separately (each has its own set of
 * `onOpenChange` reasons and popup state), so the shared prop bag has to be
 * re-cast at the drawer boundary even though the runtime shape is identical.
 */
function ResponsiveDialog(props: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  return (
    <ResponsiveDialogContext.Provider
      value={isDesktop ? 'dialog' : 'drawer'}
    >
      {isDesktop ? (
        <Dialog {...props} />
      ) : (
        <Drawer {...(props as React.ComponentProps<typeof Drawer>)} />
      )}
    </ResponsiveDialogContext.Provider>
  )
}

// ── Trigger ─────────────────────────────────────────────────────────────

type ResponsiveDialogTriggerProps = React.ComponentProps<typeof DialogTrigger> & {
  render?: React.ReactElement
}

const ResponsiveDialogTrigger = ({
  render,
  children,
  ...props
}: ResponsiveDialogTriggerProps) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return (
      <DialogTrigger render={render} {...props}>
        {children}
      </DialogTrigger>
    )
  }
  return (
    <DrawerTrigger render={render} {...props}>
      {children}
    </DrawerTrigger>
  )
}
ResponsiveDialogTrigger.displayName = 'ResponsiveDialogTrigger'

// ── Close ───────────────────────────────────────────────────────────────

type ResponsiveDialogCloseProps = React.ComponentProps<typeof DialogClose> & {
  render?: React.ReactElement
}

const ResponsiveDialogClose = ({
  render,
  children,
  ...props
}: ResponsiveDialogCloseProps) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return (
      <DialogClose render={render} {...props}>
        {children}
      </DialogClose>
    )
  }
  return (
    <DrawerClose render={render} {...props}>
      {children}
    </DrawerClose>
  )
}
ResponsiveDialogClose.displayName = 'ResponsiveDialogClose'

// ── Content ─────────────────────────────────────────────────────────────

const ResponsiveDialogContent = ({
  showCloseButton,
  initialFocus,
  finalFocus,
  ...props
}: React.ComponentProps<typeof DialogContent>) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return (
      <DialogContent
        showCloseButton={showCloseButton}
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        {...props}
      />
    )
  }
  return (
    <DrawerContent
      initialFocus={initialFocus}
      finalFocus={finalFocus}
      {...(props as React.ComponentProps<typeof DrawerContent>)}
    />
  )
}
ResponsiveDialogContent.displayName = 'ResponsiveDialogContent'

// ── Header ──────────────────────────────────────────────────────────────

const ResponsiveDialogHeader = (
  props: React.ComponentProps<typeof DialogHeader>,
) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return <DialogHeader {...props} />
  }
  return <DrawerHeader {...props} />
}
ResponsiveDialogHeader.displayName = 'ResponsiveDialogHeader'

// ── Footer ──────────────────────────────────────────────────────────────

const ResponsiveDialogFooter = (
  props: React.ComponentProps<typeof DialogFooter>,
) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return <DialogFooter {...props} />
  }
  return <DrawerFooter {...props} />
}
ResponsiveDialogFooter.displayName = 'ResponsiveDialogFooter'

// ── Title / Description ─────────────────────────────────────────────────

const ResponsiveDialogTitle = (
  props: React.ComponentProps<typeof DialogTitle>,
) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return <DialogTitle {...props} />
  }
  return <DrawerTitle {...props} />
}
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle'

const ResponsiveDialogDescription = (
  props: React.ComponentProps<typeof DialogDescription>,
) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  if (isDesktop) {
    return <DialogDescription {...props} />
  }
  return <DrawerDescription {...props} />
}
ResponsiveDialogDescription.displayName = 'ResponsiveDialogDescription'

// ── Body ────────────────────────────────────────────────────────────────

/**
 * Body slot between `ResponsiveDialogHeader` and `ResponsiveDialogFooter`.
 * Adds drawer-style horizontal padding and owns mobile scrolling; desktop
 * relies on the `DialogContent`'s built-in padding so no extra wrapper is
 * needed. Keeping the scroll owner here prevents nested drawer scrolling.
 */
const ResponsiveDialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const isDesktop = useResponsiveDialogIsDesktop()
  return (
    <div
      className={cn(
        isDesktop ? undefined : 'min-h-0 flex-1 overflow-y-auto px-4 pb-4',
        className,
      )}
      {...props}
    />
  )
}
ResponsiveDialogBody.displayName = 'ResponsiveDialogBody'

export {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
  useResponsiveDialogSurface,
}
