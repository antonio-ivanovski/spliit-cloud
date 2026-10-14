import { cn } from '@/lib/utils'

import bgFlag from '../assets/flags/bg.png'
import euFlag from '../assets/flags/eu.png'
import gbFlag from '../assets/flags/gb.png'
import usFlag from '../assets/flags/us.png'

/**
 * Static, render-safe copy of web `CurrencyIcon` for fiat codes used in promos.
 * Same DOM/classNames/aspect as the app; flag pixels are vendored locally
 * because the promo renderer blocks external requests (flagcdn).
 */
const FLAGS: Record<string, string> = {
  BG: bgFlag,
  BGN: bgFlag,
  EU: euFlag,
  EUR: euFlag,
  GB: gbFlag,
  GBP: gbFlag,
  US: usFlag,
  USD: usFlag,
}

export function PromoCurrencyIcon({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  const src = FLAGS[code.toUpperCase()]
  if (!src || !code) return null
  return (
    <img
      src={src}
      className={cn(
        'aspect-[4/3] w-[22px] shrink-0 rounded-[3px] object-cover',
        className,
      )}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
