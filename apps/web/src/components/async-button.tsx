import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'

type Props = ButtonProps & {
  action?: () => Promise<void>
  loadingContent?: ReactNode
}

export function AsyncButton({
  action,
  children,
  loadingContent,
  ...props
}: Props) {
  const [loading, setLoading] = useState(false)
  return (
    <Button
      onClick={async () => {
        try {
          setLoading(true)
          await action?.()
        } catch (err) {
          console.error(err)
        } finally {
          setLoading(false)
        }
      }}
      {...props}
    >
      {loading ? (
        <span
          key="loading"
          className="motion-content-swap inline-flex items-center"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{' '}
          {loadingContent ?? children}
        </span>
      ) : (
        <span
          key="idle"
          className="motion-content-swap inline-flex items-center"
        >
          {children}
        </span>
      )}
    </Button>
  )
}
