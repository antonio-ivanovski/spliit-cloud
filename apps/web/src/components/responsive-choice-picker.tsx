/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- custom roving-focus listbox uses ARIA semantics. */
import { Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
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

export type ResponsiveChoiceOption<T extends string = string> = {
  value: T
  label: ReactNode
  disabled?: boolean
}

export type ResponsiveChoicePickerProps<T extends string> = {
  value: T
  options: readonly ResponsiveChoiceOption<T>[]
  onValueChange: (value: T) => void
  /** Accessible name for the combobox trigger. */
  ariaLabel: string
  /** Heading shown at the top of the mobile bottom drawer. */
  mobileTitle?: ReactNode
  placeholder?: ReactNode
  disabled?: boolean
  className?: string
  triggerClassName?: string
}

/**
 * A single-choice picker that keeps the interaction consistent across form
 * factors: a compact popover on desktop and a bottom drawer on mobile.
 */
export function ResponsiveChoicePicker<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  mobileTitle,
  placeholder = 'Select',
  disabled = false,
  className,
  triggerClassName,
}: ResponsiveChoicePickerProps<T>) {
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const selected = options.find((option) => option.value === value)
  const displayValue = selected?.label ?? placeholder

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- active option must follow the controlled value for keyboard navigation.
    setActiveIndex(selectedIndex)
  }, [selectedIndex])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [activeIndex, open])

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
    },
    [],
  )

  const select = (nextValue: T) => {
    onValueChange(nextValue)
    setOpen(false)
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      disabled={disabled}
      onKeyDown={(event) => {
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault()
          setOpen(true)
        }
      }}
      className={cn(
        'h-10 min-w-0 justify-between gap-2 px-3 font-normal',
        className,
        triggerClassName,
      )}
    >
      <span className="min-w-0 truncate">{displayValue}</span>
      <ChevronsUpDown
        className="h-4 w-4 shrink-0 opacity-50"
        aria-hidden="true"
      />
    </Button>
  )

  const choices = (
    <div role="listbox" aria-label={ariaLabel} className="grid gap-1">
      {options.map((option) => {
        const selected = option.value === value
        const index = options.indexOf(option)
        return (
          <button
            key={option.value}
            id={`responsive-choice-option-${index}`}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={index === activeIndex ? 0 : -1}
            disabled={option.disabled}
            ref={(element) => {
              optionRefs.current[index] = element
            }}
            className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            onFocus={() => setActiveIndex(index)}
            onKeyDown={(event) => {
              const enabled = options
                .map((candidate, candidateIndex) =>
                  candidate.disabled ? -1 : candidateIndex,
                )
                .filter((candidateIndex) => candidateIndex >= 0)
              if (enabled.length === 0) return
              const currentPosition = Math.max(0, enabled.indexOf(index))
              let nextPosition: number | null = null
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                nextPosition = (currentPosition + 1) % enabled.length
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                nextPosition =
                  (currentPosition - 1 + enabled.length) % enabled.length
              } else if (event.key === 'Home') {
                nextPosition = 0
              } else if (event.key === 'End') {
                nextPosition = enabled.length - 1
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
                return
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                select(option.value)
                return
              } else if (event.key.length === 1 && /\S/.test(event.key)) {
                const search = `${typeaheadRef.current}${event.key.toLowerCase()}`
                const match = enabled.find((candidateIndex) => {
                  const label = options[candidateIndex]?.label
                  return (
                    typeof label === 'string' &&
                    label
                      .toLowerCase()
                      .split(/\s+/)
                      .some((word) => word.startsWith(search))
                  )
                })
                typeaheadRef.current = search
                if (typeaheadTimerRef.current) {
                  clearTimeout(typeaheadTimerRef.current)
                }
                typeaheadTimerRef.current = setTimeout(() => {
                  typeaheadRef.current = ''
                }, 500)
                if (match === undefined) return
                event.preventDefault()
                setActiveIndex(match)
                optionRefs.current[match]?.focus()
                return
              }
              if (nextPosition === null) return
              event.preventDefault()
              setActiveIndex(enabled[nextPosition])
              optionRefs.current[enabled[nextPosition]]?.focus()
            }}
            onClick={() => select(option.value)}
          >
            <Check
              className={cn(
                'h-4 w-4 shrink-0 text-primary',
                selected ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">{option.label}</span>
          </button>
        )
      })}
    </div>
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent
          className="w-[var(--anchor-width)] min-w-40 p-1"
          align="start"
        >
          {choices}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger render={trigger} />
      <DrawerContent className="p-0">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle>{mobileTitle ?? ariaLabel}</DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[min(60dvh,28rem)] overflow-y-auto px-3 pb-4">
          {choices}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
