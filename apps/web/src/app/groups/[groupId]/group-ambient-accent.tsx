import { useEffect } from 'react'

import { useSetAmbientAccent } from '@/components/ambient-backdrop'
import { resolveGroupColorHex } from '@spliit/domain'

/**
 * Pushes the group's resolved color up to the page ambient backdrop. Only
 * regular groups with a resolvable color tint; friend ledgers, colorless
 * groups, and the loading state keep the default emerald/coral wash. Clears on
 * unmount so the tint never leaks onto other routes.
 */
export function GroupAmbientAccent({
  color,
  groupType,
}: {
  color: string | null | undefined
  groupType: 'GROUP' | 'FRIEND' | null | undefined
}) {
  const setAmbientAccent = useSetAmbientAccent()

  useEffect(() => {
    setAmbientAccent(groupType === 'GROUP' ? resolveGroupColorHex(color) : null)
    return () => {
      setAmbientAccent(null)
    }
  }, [color, groupType, setAmbientAccent])

  return null
}
