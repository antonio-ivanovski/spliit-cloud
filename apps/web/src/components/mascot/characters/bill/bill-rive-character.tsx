import { useReducedMotion } from 'motion/react'
import { Component, lazy, Suspense, type ReactNode } from 'react'

import { BillFallback } from './bill-fallback'
import type { BillRiveProps } from './bill-rive-types'

const BillRiveCanvas = lazy(() => import('./bill-rive-canvas'))

class ArtworkBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Activated only after the exported asset passes visual and licensing checks. */
export function BillRiveCharacter(props: BillRiveProps) {
  const reducedMotion = useReducedMotion()
  const fallback = <BillFallback {...props} />
  if (reducedMotion) return fallback
  return (
    <ArtworkBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <BillRiveCanvas key={props.assetUrl} {...props} />
      </Suspense>
    </ArtworkBoundary>
  )
}
