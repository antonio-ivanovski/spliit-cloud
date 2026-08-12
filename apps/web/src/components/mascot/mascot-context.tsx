import type { LucideIcon } from 'lucide-react'
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type MascotReaction = 'idle' | 'thinking' | 'success' | 'failure'

export type MascotAction = {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  primary?: boolean
}

type ActionRegistration = {
  token: symbol
  order: number
  actions: MascotAction[]
}

type MascotContextValue = {
  actions: MascotAction[]
  busy: boolean
  reaction: MascotReaction
  reactionKey: number
  registerActions: (owner: string, actions: MascotAction[]) => () => void
  setBusy: (owner: string, busy: boolean) => void
  react: (reaction: MascotReaction, duration?: number) => void
}

const MascotContext = createContext<MascotContextValue | null>(null)

const DEFAULT_REACTION_DURATION: Record<
  Exclude<MascotReaction, 'idle' | 'thinking'>,
  number
> = {
  success: 2_300,
  failure: 2_600,
}

export function MascotProvider({ children }: PropsWithChildren) {
  const registrations = useRef(new Map<string, ActionRegistration>())
  const busyOwners = useRef(new Set<string>())
  const registrationOrder = useRef(0)
  const reactionTimer = useRef<number | null>(null)
  const [actions, setActions] = useState<MascotAction[]>([])
  const [busy, setBusyState] = useState(false)
  const [reaction, setReaction] = useState<MascotReaction>('idle')
  const [reactionKey, setReactionKey] = useState(0)

  const publishActions = useCallback(() => {
    const latest = [...registrations.current.values()].toSorted(
      (left, right) => right.order - left.order,
    )[0]
    setActions(latest?.actions ?? [])
  }, [])

  const registerActions = useCallback(
    (owner: string, actions: MascotAction[]) => {
      const token = Symbol(owner)
      registrations.current.set(owner, {
        token,
        order: ++registrationOrder.current,
        actions,
      })
      publishActions()

      return () => {
        if (registrations.current.get(owner)?.token !== token) return
        registrations.current.delete(owner)
        publishActions()
      }
    },
    [publishActions],
  )

  const setBusy = useCallback((owner: string, nextBusy: boolean) => {
    if (nextBusy) busyOwners.current.add(owner)
    else busyOwners.current.delete(owner)
    setBusyState(busyOwners.current.size > 0)
  }, [])

  const react = useCallback(
    (nextReaction: MascotReaction, duration?: number) => {
      if (reactionTimer.current !== null) {
        window.clearTimeout(reactionTimer.current)
        reactionTimer.current = null
      }
      setReaction(nextReaction)
      setReactionKey((key) => key + 1)

      if (nextReaction === 'success' || nextReaction === 'failure') {
        reactionTimer.current = window.setTimeout(() => {
          setReaction('idle')
          setReactionKey((key) => key + 1)
          reactionTimer.current = null
        }, duration ?? DEFAULT_REACTION_DURATION[nextReaction])
      }
    },
    [],
  )

  useEffect(
    () => () => {
      if (reactionTimer.current !== null) {
        window.clearTimeout(reactionTimer.current)
      }
    },
    [],
  )

  const value = useMemo<MascotContextValue>(
    () => ({
      actions,
      busy,
      reaction,
      reactionKey,
      registerActions,
      setBusy,
      react,
    }),
    [actions, busy, react, reaction, reactionKey, registerActions, setBusy],
  )

  return (
    <MascotContext.Provider value={value}>{children}</MascotContext.Provider>
  )
}

export function useMascotActions(
  owner: string,
  actions: MascotAction[],
  enabled = true,
) {
  const mascot = useContext(MascotContext)
  const registerActions = mascot?.registerActions

  useEffect(() => {
    if (!registerActions || !enabled) return
    return registerActions(owner, actions)
  }, [actions, enabled, owner, registerActions])
}

export function useMascotBusy(owner: string, busy: boolean) {
  const mascot = useContext(MascotContext)
  const setBusy = mascot?.setBusy

  useEffect(() => {
    if (!setBusy) return
    setBusy(owner, busy)
    return () => setBusy(owner, false)
  }, [busy, owner, setBusy])
}

export function useMascotController() {
  const mascot = useContext(MascotContext)
  return useMemo(
    () => ({
      react: mascot?.react ?? (() => undefined),
    }),
    [mascot?.react],
  )
}

export function useMascotState() {
  return useContext(MascotContext)
}
