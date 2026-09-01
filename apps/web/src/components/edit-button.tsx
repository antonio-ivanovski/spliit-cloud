import { Pencil } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = Omit<ButtonProps, 'children'> & {
  /** Label shown alongside the pencil icon. */
  label: string
  /** Optional testid forwarded to the underlying button. */
  testId?: string
}

/**
 * Shared "Edit" action button reused by the expense preview modal and the
 * budget detail modal. Keeps variant, icon, and hover behavior consistent. Pass
 * `render={<Link to=... />}` when the control should be a real link.
 */
export function EditButton({
  className,
  label,
  testId,
  render,
  type,
  ...rest
}: Props) {
  return (
    <Button
      type={render ? type : (type ?? 'button')}
      render={render}
      {...rest}
      data-testid={testId}
      className={cn('flex-1 sm:flex-none', className)}
    >
      <Pencil className="me-1.5 h-4 w-4 shrink-0 sm:me-2" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Button>
  )
}
