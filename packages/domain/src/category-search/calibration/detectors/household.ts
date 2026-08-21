import { boost, containsAny, demote, type CalibrateArgs } from '../utils'

export function applyHousehold({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  if (
    /things?\s+for\s+home/i.test(needle) ||
    /thingies\s+for\s+home/i.test(needle) ||
    containsAny(needle, [
      'essuie-tout',
      'essuie',
      'papier toilette',
      'toilet paper',
    ])
  ) {
    let out = boost(ranked, 'household-supplies', 0.96)
    out = demote(out, 'home', 0.5)
    out = demote(out, 'groceries', 0.5)
    out = demote(out, 'furniture', 0.5)
    return out
  }
  return ranked
}
