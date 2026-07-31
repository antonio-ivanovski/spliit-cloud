import { Pencil } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = Omit<ButtonProps, 'children' | 'asChild'> & {
  onClick: () => void
  /** Label shown alongside the pencil icon. */
  label: string
  /** Optional testid forwarded to the underlying button. */
  testId?: string
}

/**
 * Shared "Edit" action button reused by the expense preview modal and the
 * budget detail modal. Keeps variant, icon, and hover behavior consistent.
 */
export function EditButton({
  className,
  label,
  onClick,
  testId,
  ...rest
}: Props) {
  return (
    <Button
      type="button"
      {...rest}
      data-testid={testId}
      onClick={onClick}
      className={cn('flex-1 sm:flex-none', className)}
    >
      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  )
}
