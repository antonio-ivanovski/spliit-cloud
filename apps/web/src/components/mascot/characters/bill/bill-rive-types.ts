import type { RefObject } from 'react'

import type { MascotCharacterProps } from '../../mascot-character'

export type BillInteraction = {
  gazeX: number
  gazeY: number
  hovered: boolean
  pressed: boolean
  dragging: boolean
  velocityX: number
  releaseKey: number
  personalityKey: number
}

export type BillRiveProps = MascotCharacterProps & {
  assetUrl: string
  interaction?: RefObject<BillInteraction>
  sortingPhase?: 'waiting' | 'catching' | 'reading' | 'filing'
}

export const BILL_POSES = {
  thinking: 0,
  success: 1,
  celebrate: 2,
  acknowledge: 3,
  welcome: 4,
  failure: 5,
  pickedUp: 6,
  settle: 7,
  wiggle: 8,
  bashful: 9,
  stretch: 10,
  waiting: 11,
  catching: 12,
  reading: 13,
  filing: 14,
  idle: 17,
} as const
