import { AccountAvatar } from '@/components/account-avatar'
import type { AccountIdentity } from '@/lib/account'
import { cn } from '@/lib/utils'

type Props = {
  accounts: AccountIdentity[]
  max?: number
  size?: 'sm' | 'md'
  className?: string
  label: string
}

const sizeClass = { sm: 'size-6', md: 'size-8' }

export function AvatarStack({
  accounts,
  max = 4,
  size = 'sm',
  className,
  label,
}: Props) {
  const visible = accounts.slice(0, max)
  const hiddenCount = accounts.length - visible.length
  if (visible.length === 0) return null

  return (
    <div
      className={cn('isolate flex items-center', className)}
      aria-label={label}
    >
      {visible.map((account, index) => (
        <AccountAvatar
          key={account.id}
          account={account}
          variant="stack"
          size={size === 'sm' ? 'md' : 'lg'}
          className={cn(sizeClass[size], index > 0 && '-ms-2')}
        />
      ))}
      {hiddenCount > 0 && (
        <span
          className={cn(
            '-ms-2 grid place-items-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground',
            sizeClass[size],
          )}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  )
}
