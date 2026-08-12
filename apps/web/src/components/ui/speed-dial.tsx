import * as React from 'react'

import { cn } from '@/lib/utils'

type SpeedDialContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
}

const SpeedDialContext = React.createContext<SpeedDialContextValue | null>(
  null,
)

function useSpeedDialContext() {
  const context = React.useContext(SpeedDialContext)
  if (!context) throw new Error('SpeedDial components must be nested in SpeedDial')
  return context
}

type SpeedDialProps = React.HTMLAttributes<HTMLDivElement> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  ref?: React.Ref<HTMLDivElement>
}

function SpeedDial({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ref,
  ...props
}: SpeedDialProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, openProp],
  )

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !contentRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [setOpen, open])

  return (
    <SpeedDialContext.Provider
      value={{ open, setOpen, triggerRef, contentRef }}
    >
      <div
        ref={ref}
        data-state={open ? 'open' : 'closed'}
        className={cn('pointer-events-none flex flex-col items-end', className)}
        {...props}
      >
        {children}
      </div>
    </SpeedDialContext.Provider>
  )
}

const SpeedDialTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = useSpeedDialContext()
  return (
    <button
      ref={(node) => {
        triggerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      type="button"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(!open)
      }}
      className={cn('pointer-events-auto', className)}
      {...props}
    />
  )
})
SpeedDialTrigger.displayName = 'SpeedDialTrigger'

const SpeedDialContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { open, contentRef } = useSpeedDialContext()
  return (
    <div
      ref={(node) => {
        contentRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      role="menu"
      aria-hidden={!open}
      className={cn(
        'pointer-events-none flex flex-col-reverse items-end gap-2 pb-3 transition-[opacity,transform] duration-200',
        open
          ? 'translate-y-0 opacity-100'
          : 'translate-y-2 opacity-0',
        className,
      )}
      {...props}
    />
  )
})
SpeedDialContent.displayName = 'SpeedDialContent'

const SpeedDialItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('pointer-events-none flex items-center gap-2', className)}
    {...props}
  />
))
SpeedDialItem.displayName = 'SpeedDialItem'

const SpeedDialLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      'pointer-events-none rounded-md border bg-background/95 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shadow-md backdrop-blur',
      className,
    )}
    {...props}
  />
))
SpeedDialLabel.displayName = 'SpeedDialLabel'

const SpeedDialAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, disabled, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = useSpeedDialContext()
  const interactive = open && !disabled
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      data-speed-dial-action
      tabIndex={open ? 0 : -1}
      disabled={!interactive}
      className={cn(
        interactive ? 'pointer-events-auto' : 'pointer-events-none',
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
      {...props}
    />
  )
})
SpeedDialAction.displayName = 'SpeedDialAction'

export {
  SpeedDial,
  SpeedDialAction,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  SpeedDialTrigger,
}
