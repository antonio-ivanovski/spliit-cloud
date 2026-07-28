import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

import Link from '@/components/link'
import { cn } from '@/lib/utils'

type SecondaryAction = {
  href: string
  icon: ReactNode
  label: string
  'data-testid'?: string
}

/**
 * A primary-tinted action card used as the first item in the groups/friends
 * lists. It keeps the same height as `GroupCard`, but reads as an action
 * surface rather than another existing ledger.
 *
 * Pass `secondaryAction` to split the card into primary and secondary action
 * zones, e.g. create on the left and import on the right.
 */
export function CreateCard({
  href,
  icon,
  title,
  description,
  secondaryAction,
  className,
  'data-testid': dataTestId,
}: {
  href: string
  icon?: ReactNode
  title: string
  description: string
  secondaryAction?: SecondaryAction
  className?: string
  'data-testid'?: string
}) {
  const iconClassName =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/15'

  return (
    <li className="min-w-0">
      <div
        className={cn(
          'relative h-full min-h-[5.5rem] w-full overflow-hidden rounded-lg border border-primary/25 bg-linear-to-br from-primary/8 via-background to-background text-base shadow-[0_1px_0_0_hsl(var(--primary)/0.08)] transition-colors hover:border-primary/35',
          className,
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 -right-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
        />
        <div
          className={cn(
            'relative grid h-full min-h-[5.5rem]',
            secondaryAction && 'grid-cols-[minmax(0,1fr)_7rem]',
          )}
        >
          <Link
            href={href}
            data-testid={dataTestId}
            className="flex min-w-0 items-center gap-3 px-3 py-3 text-foreground no-underline outline-hidden transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:underline"
          >
            <span aria-hidden className={iconClassName}>
              {icon ?? <Plus className="h-4 w-4" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{title}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {description}
              </span>
            </span>
          </Link>
          {secondaryAction ? (
            <Link
              href={secondaryAction.href}
              data-testid={secondaryAction['data-testid']}
              className="flex min-w-0 flex-col items-center justify-center gap-1 border-l border-primary/15 px-2 py-2 text-center text-xs leading-tight font-medium text-primary no-underline outline-hidden transition-colors hover:bg-primary/8 focus-visible:bg-primary/8 focus-visible:underline"
            >
              <span aria-hidden className="text-primary">
                {secondaryAction.icon}
              </span>
              <span className="max-w-full truncate">
                {secondaryAction.label}
              </span>
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  )
}
