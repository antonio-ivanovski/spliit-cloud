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
const ResponsiveDialogContext = React.createContext<boolean>(true)

type ResponsiveDialogProps = React.ComponentProps<typeof Dialog> & {
  /** vaul-only: scales the page behind the drawer. Ignored on desktop. */
  shouldScaleBackground?: boolean
}

function ResponsiveDialog({
  shouldScaleBackground,
  ...props
}: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  return (
    <ResponsiveDialogContext.Provider value={isDesktop}>
      {isDesktop ? (
        <Dialog {...props} />
      ) : (
        <Drawer shouldScaleBackground={shouldScaleBackground} {...props} />
      )}
    </ResponsiveDialogContext.Provider>
  )
}

// ── Trigger ─────────────────────────────────────────────────────────────

const ResponsiveDialogTrigger = (
  props: React.ComponentProps<typeof DialogTrigger>,
) => {
  const isDesktop = React.useContext(ResponsiveDialogContext)
  if (isDesktop) {
    return <DialogTrigger {...props} />
  }
  return <DrawerTrigger {...props} />
}
ResponsiveDialogTrigger.displayName = 'ResponsiveDialogTrigger'

// ── Close ───────────────────────────────────────────────────────────────

const ResponsiveDialogClose = (
  props: React.ComponentProps<typeof DialogClose>,
) => {
  const isDesktop = React.useContext(ResponsiveDialogContext)
  if (isDesktop) {
    return <DialogClose {...props} />
  }
  return <DrawerClose {...props} />
}
ResponsiveDialogClose.displayName = 'ResponsiveDialogClose'

// ── Content ─────────────────────────────────────────────────────────────

const ResponsiveDialogContent = (
  props: React.ComponentProps<typeof DialogContent>,
) => {
  const isDesktop = React.useContext(ResponsiveDialogContext)
  if (isDesktop) {
    return <DialogContent {...props} />
  }
  return <DrawerContent {...props} />
}
ResponsiveDialogContent.displayName = 'ResponsiveDialogContent'

// ── Header ──────────────────────────────────────────────────────────────

const ResponsiveDialogHeader = (
  props: React.ComponentProps<typeof DialogHeader>,
) => {
  const isDesktop = React.useContext(ResponsiveDialogContext)
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
  const isDesktop = React.useContext(ResponsiveDialogContext)
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
  const isDesktop = React.useContext(ResponsiveDialogContext)
  if (isDesktop) {
    return <DialogTitle {...props} />
  }
  return <DrawerTitle {...props} />
}
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle'

const ResponsiveDialogDescription = (
  props: React.ComponentProps<typeof DialogDescription>,
) => {
  const isDesktop = React.useContext(ResponsiveDialogContext)
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
  const isDesktop = React.useContext(ResponsiveDialogContext)
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
}
