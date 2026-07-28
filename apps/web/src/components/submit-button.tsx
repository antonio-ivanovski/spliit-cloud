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
  ...props
}: Props) {
  const { isSubmitting } = useFormState()
  return (
    <Button
      type="submit"
      disabled={isSubmitting}
      className={cn('min-w-28', className)}
      {...props}
    >
      <span className="inline-flex items-center whitespace-nowrap">
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
