import { Effect, SubscriptionRef } from 'effect'
import { useMemo, useSyncExternalStore } from 'react'

export interface SnapshotBridge<S> {
  readonly ref: SubscriptionRef.SubscriptionRef<S>
  readonly getSnapshot: () => S
  readonly subscribe: (listener: () => void) => () => void
  readonly publish: (next: S) => void
  readonly update: (fn: (current: S) => S) => void
  readonly readEffect: Effect.Effect<S>
  readonly writeEffect: (next: S) => Effect.Effect<void>
  readonly updateEffect: (fn: (current: S) => S) => Effect.Effect<void>
}

export function createSnapshotBridge<S>(initial: S): SnapshotBridge<S> {
  const ref = Effect.runSync(SubscriptionRef.make(initial))
  const listeners = new Set<() => void>()

  const getSnapshot = (): S => Effect.runSync(SubscriptionRef.get(ref))

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const notifyEffect = (): Effect.Effect<void> => Effect.sync(emit)

  const publish = (next: S): void => {
    const current = getSnapshot()
    if (Object.is(next, current)) return
    Effect.runSync(SubscriptionRef.set(ref, next))
    emit()
  }

  const update = (fn: (current: S) => S): void => {
    publish(fn(getSnapshot()))
  }

  return {
    ref,
    getSnapshot,
    subscribe,
    publish,
    update,
    readEffect: SubscriptionRef.get(ref),
    writeEffect: (next: S) =>
      Effect.andThen(SubscriptionRef.set(ref, next), notifyEffect()),
    updateEffect: (fn: (current: S) => S) =>
      Effect.andThen(SubscriptionRef.update(ref, fn), notifyEffect()),
  }
}

export function useServiceSnapshot<S, T>(
  bridge: SnapshotBridge<S>,
  selector: (snapshot: S) => T,
): T {
  const getSelectedSnapshot = useMemo(() => {
    // Selector cache: property writes on a stable holder keep getSnapshot
    // referentially stable per snapshot/selection (the documented
    // useSyncExternalStore selector pattern; no render-phase state).
    const cache: {
      snapshot: S | undefined
      selected: T | undefined
      hasValue: boolean
    } = { snapshot: undefined, selected: undefined, hasValue: false }
    return (): T => {
      const snapshot = bridge.getSnapshot()
      if (cache.hasValue && Object.is(snapshot, cache.snapshot)) {
        return cache.selected as T
      }
      const selected = selector(snapshot)
      if (cache.hasValue && Object.is(selected, cache.selected)) {
        // oxlint-disable-next-line react/immutability -- selector cache write confined to the getSnapshot closure (the documented selector pattern); not render-phase state.
        cache.snapshot = snapshot
        return cache.selected as T
      }
      cache.snapshot = snapshot
      cache.selected = selected
      cache.hasValue = true
      return selected
    }
  }, [bridge, selector])
  return useSyncExternalStore(bridge.subscribe, getSelectedSnapshot)
}
