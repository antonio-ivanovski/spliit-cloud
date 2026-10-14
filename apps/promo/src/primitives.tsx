import { Badge } from '@web/components/ui/badge'
import { ArrowRight, Zap } from 'lucide-react'
import type { ReactNode } from 'react'

import logo from '../../web/public/logo-with-text.svg'
import type { PromoSize } from './catalog'

export function Canvas({
  width,
  height,
  children,
  className = '',
}: PromoSize & { children: ReactNode; className?: string }) {
  return (
    <main
      data-promo-canvas
      className={`promo-canvas ${className}`}
      style={{ width, height }}
    >
      {children}
    </main>
  )
}

export function BrandHeader({
  version,
  children,
}: {
  version?: string
  children?: ReactNode
}) {
  return (
    <header className="brand-header">
      <img src={logo} alt="Spliit Cloud" />
      {version && (
        <Badge className="version-badge" variant="outline">
          {version}
        </Badge>
      )}
      <div className="header-aside">{children}</div>
    </header>
  )
}

export function Headline({
  children,
  subtitle,
}: {
  children: ReactNode
  subtitle?: ReactNode
}) {
  return (
    <div className="headline">
      <h1>{children}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  )
}

export function UiFrame({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`ui-frame ${className}`}>{children}</section>
}

export function Metric({
  value,
  label,
  compact = false,
}: {
  value: ReactNode
  label: string
  compact?: boolean
}) {
  return (
    <div className={`metric ${compact ? 'metric-compact' : ''}`}>
      <span className="metric-icon">
        <Zap aria-hidden="true" />
      </span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </div>
  )
}

export function Connector() {
  return (
    <div className="connector" aria-label="Then">
      <ArrowRight aria-hidden="true" />
    </div>
  )
}

export function Footer({ children }: { children: ReactNode }) {
  return <footer className="promo-footer">{children}</footer>
}
