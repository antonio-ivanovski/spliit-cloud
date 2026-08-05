import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useFormState } from 'react-hook-form'

import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  loadingContent: ReactNode
} & ButtonProps

export function SubmitButton({
  children,
  loadingContent,
  className,
  disabled,
  ...props
}: Props) {
  const { isSubmitting } = useFormState()
  return (
    <Button
      type="submit"
      // An explicit `disabled` (e.g. the terminal persisted state) wins;
      // otherwise the button disables while a submit is in flight. `disabled`
      // must be destructured — spreading it back would clobber this default
      // with `undefined`.
      disabled={disabled ?? isSubmitting}
      className={cn('min-w-28', className)}
      {...props}
    >
      <span
        key={isSubmitting ? 'submitting' : 'idle'}
        className="motion-content-swap inline-flex items-center whitespace-nowrap"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {loadingContent}
          </>
        ) : (
          children
        )}
      </span>
    </Button>
  )
}
