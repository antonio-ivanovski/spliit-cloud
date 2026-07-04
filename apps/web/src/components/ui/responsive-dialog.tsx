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

type ResponsiveDialogProps = React.ComponentProps<typeof Dialog> & {
  /** vaul-only: scales the page behind the drawer. Ignored on desktop. */
  shouldScaleBackground?: boolean
}

function ResponsiveDialog({
  shouldScaleBackground,
  ...props
}: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  if (isDesktop) {
    return <Dialog {...props} />
  }
  return <Drawer shouldScaleBackground={shouldScaleBackground} {...props} />
}

// ── Trigger ─────────────────────────────────────────────────────────────

const ResponsiveDialogTrigger = (
  props: React.ComponentProps<typeof DialogTrigger>,
) => {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
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
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
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
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
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
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
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
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
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
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  if (isDesktop) {
    return <DialogTitle {...props} />
  }
  return <DrawerTitle {...props} />
}
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle'

const ResponsiveDialogDescription = (
  props: React.ComponentProps<typeof DialogDescription>,
) => {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  if (isDesktop) {
    return <DialogDescription {...props} />
  }
  return <DrawerDescription {...props} />
}
ResponsiveDialogDescription.displayName = 'ResponsiveDialogDescription'

// ── Body ────────────────────────────────────────────────────────────────

/**
 * Body slot between `ResponsiveDialogHeader` and `ResponsiveDialogFooter`.
 * Adds drawer-style horizontal padding on mobile; desktop relies on the
 * `DialogContent`'s built-in padding so no extra wrapper is needed.
 */
const ResponsiveDialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  return (
    <div
      className={cn(isDesktop ? undefined : 'px-4 pb-4', className)}
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