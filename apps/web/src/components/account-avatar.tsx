import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { AccountIdentity } from '@/lib/account'
import { cn } from '@/lib/utils'

type Props = {
  account: AccountIdentity
  className?: string
  variant?: 'default' | 'stack'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}

const sizeClasses = {
  xs: 'size-4 text-[8px]',
  sm: 'size-5 text-[10px]',
  md: 'size-6 text-xs',
  lg: 'size-8 text-sm',
  xl: 'size-16 text-2xl',
}

export function AccountAvatar({
  account,
  className,
  variant = 'default',
  size = 'md',
}: Props) {
  const initials =
    account.name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'

  return (
    <Avatar
      className={cn(
        variant === 'stack'
          ? 'bg-background ring-2 ring-background'
          : 'bg-primary/15 ring-1 ring-primary/20',
        sizeClasses[size],
        className,
      )}
    >
      <AvatarFallback className="bg-primary/15 leading-none font-semibold text-[inherit] text-primary">
        {initials}
      </AvatarFallback>
      {account.image && (
        <AvatarImage
          key={account.image}
          src={account.image}
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
    </Avatar>
  )
}
