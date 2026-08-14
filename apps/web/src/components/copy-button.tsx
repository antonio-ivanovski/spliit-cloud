import { Check, Copy } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'

import { Button, type ButtonProps } from '@/components/ui/button'

type Props = {
  text: string
  /** Accessible name for the copy action (required — icon-only button). */
  ariaLabel: string
  /** Live-region feedback announced when the copy succeeds. */
  copiedLabel: string
  className?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}

export const CopyButton = forwardRef<HTMLButtonElement, Props>(
  function CopyButton(
    {
      text,
      ariaLabel,
      copiedLabel,
      className,
      size = 'icon',
      variant = 'secondary',
    },
    ref,
  ) {
    const [copied, setCopied] = useState(false)

    useEffect(() => {
      if (copied) {
        const timeout = setTimeout(() => setCopied(false), 1500)
        return () => {
          setCopied(false)
          clearTimeout(timeout)
        }
      }
    }, [copied])

    return (
      <Button
        ref={ref}
        size={size}
        variant={variant}
        className={className}
        type="button"
        aria-label={ariaLabel}
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setCopied(true)
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <output aria-live="polite" className="sr-only">
          {copied ? copiedLabel : ''}
        </output>
      </Button>
    )
  },
)
