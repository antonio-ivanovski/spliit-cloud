import { boost, hasWord, type CalibrateArgs } from '../utils'

/**
 * 6A: siirto always payment (Finnish transfer). Guard is early-return so no
 * other detector can demote it. Shared.json already contains siirto, but this
 * forces top score even when rank is weak.
 */
export function applySiirto({ needle, ranked }: CalibrateArgs): {
  ranked: typeof ranked
  handled: boolean
} {
  if (hasWord(needle, 'siirto')) {
    return { ranked: boost(ranked, 'payment', 1), handled: true }
  }
  return { ranked, handled: false }
}
