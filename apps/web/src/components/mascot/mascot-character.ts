import type { MascotReaction } from './mascot-context'

export type MascotCharacterProps = {
  className?: string
  docked?: boolean
  open?: boolean
  reaction?: MascotReaction
  reactionKey?: number
}
