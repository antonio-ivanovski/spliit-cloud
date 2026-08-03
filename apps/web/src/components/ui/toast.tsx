import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

type ToastVariant = 'default' | 'success' | 'destructive'

type ToastData = {
  variant?: ToastVariant
  action?: React.ReactNode
}

const toastManager = ToastPrimitive.createToastManager<ToastData>()

const ToastProvider = ({
  children,
  ...props
}: Omit<ToastPrimitive.Provider.Props, 'toastManager'>) => (
  <ToastPrimitive.Provider toastManager={toastManager} limit={1} {...props}>
    {children}
  </ToastPrimitive.Provider>
)

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'pointer-events-none fixed top-0 z-100 flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = 'ToastViewport'

const toastVariants = cva(
  'motion-toast group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-[transform,opacity] data-[swiping]:transition-none data-[ending-style]:opacity-0 data-[ending-style]:translate-x-[calc(var(--toast-swipe-movement-x)+100%)] data-[starting-style]:translate-y-[-100%] sm:data-[starting-style]:translate-y-[100%] data-[ending-style]:data-[swipe-direction=right]:translate-x-[calc(var(--toast-swipe-movement-x)+100%)] data-[ending-style]:data-[swipe-direction=left]:translate-x-[calc(var(--toast-swipe-movement-x)-100%)] data-[ending-style]:data-[swipe-direction=down]:translate-y-[calc(var(--toast-swipe-movement-y)+100%)] data-[ending-style]:data-[swipe-direction=up]:translate-y-[calc(var(--toast-swipe-movement-y)-100%)] [transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-swipe-movement-y))]',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        success:
          'success group border-emerald-500/25 bg-emerald-50 text-emerald-950 dark:border-emerald-400/20 dark:bg-emerald-950 dark:text-emerald-50',
        destructive:
          'destructive group border-destructive bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, toast: toastObject, ...props }, ref) => {
  const resolvedVariant =
    variant ??
    (toastObject.data?.variant as ToastVariant | undefined) ??
    (toastObject.type as ToastVariant | undefined) ??
    'default'

  return (
    <ToastPrimitive.Root
      ref={ref}
      toast={toastObject}
      className={cn(toastVariants({ variant: resolvedVariant }), className)}
      {...props}
    />
  )
})
Toast.displayName = 'Toast'

const ToastAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<'button'> & { altText?: string }
>(({ className, altText, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={altText}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 hover:group-[.destructive]:border-destructive/30 hover:group-[.destructive]:bg-destructive hover:group-[.destructive]:text-destructive-foreground focus:group-[.destructive]:ring-destructive',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = 'ToastAction'

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-hidden focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 hover:group-[.destructive]:text-red-50 focus:group-[.destructive]:ring-red-400 focus:group-[.destructive]:ring-offset-red-600',
      className,
    )}
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = 'ToastClose'

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
))
ToastTitle.displayName = 'ToastTitle'

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
))
ToastDescription.displayName = 'ToastDescription'

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toastManager,
  type ToastActionElement,
  type ToastData,
  type ToastProps,
  type ToastVariant,
}
