import * as React from 'react'

import { Input } from '@/components/ui/input'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Search, XCircle } from 'lucide-react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onValueChange?: (value: string) => void
  containerClassName?: string
}

const SearchBar = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, containerClassName, type, onValueChange, ...props },
    ref,
  ) => {
    const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
    const [value, _setValue] = React.useState('')

    const setValue = (v: string) => {
      _setValue(v)
      onValueChange?.(v)
    }

    return (
      <div className={cn('flex relative', containerClassName)}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type={type}
          className={cn(
            'pl-10 h-9 text-sm focus:text-base bg-muted border-none text-muted-foreground',
            className,
          )}
          ref={ref}
          placeholder={t('searchPlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          {...props}
        />
        {!value ? null : (
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-10 touch-manipulation items-center justify-center rounded-r-md"
            aria-label={t('clearSearch')}
            onClick={() => setValue('')}
          >
            <XCircle className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  },
)
SearchBar.displayName = 'SearchBar'

export { SearchBar }
