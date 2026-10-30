import { useRive } from '@rive-app/react-webgl2'
import { Alignment, Fit, Layout, RuntimeLoader } from '@rive-app/webgl2'
import type { Rive, ViewModelInstance } from '@rive-app/webgl2'
import wasmUrl from '@rive-app/webgl2/rive.wasm?url'
import { useEffect, useRef, useState } from 'react'

import { BillFallback } from './bill-fallback'
import { BILL_POSES, type BillRiveProps } from './bill-rive-types'

RuntimeLoader.setWasmUrl(wasmUrl)

// Share the download; each canvas owns its own state machine and view model.
const files = new Map<string, Promise<ArrayBuffer>>()
function loadFile(url: string) {
  let file = files.get(url)
  if (!file) {
    file = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('Bill artwork could not be loaded')
        return response.arrayBuffer()
      })
      .catch((error: unknown) => {
        files.delete(url)
        throw error
      })
    files.set(url, file)
  }
  return file
}

function number(model: ViewModelInstance, name: string, value: number) {
  const property = model.number(name)
  if (property) property.value = value
}

function perform(model: ViewModelInstance, pose: keyof typeof BILL_POSES) {
  number(model, 'pose', BILL_POSES[pose])
  model.trigger('perform')?.trigger()
}

export default function BillRiveCanvas(props: BillRiveProps) {
  const [buffer, setBuffer] = useState<ArrayBuffer>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void loadFile(props.assetUrl).then(
      (data) => {
        if (!cancelled) setBuffer(data)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [props.assetUrl])
  if (failed || !buffer) return <BillFallback {...props} />
  return <LoadedBill {...props} buffer={buffer} />
}

function LoadedBill(props: BillRiveProps & { buffer: ArrayBuffer }) {
  const { buffer, className, interaction, docked = false } = props
  const [failed, setFailed] = useState(false)
  const current = useRef(props)
  useEffect(() => {
    current.current = props
  }, [props])

  function initialize(rive: Rive) {
    const model = rive.viewModelInstance
    if (!model) {
      setFailed(true)
      return
    }
    const open = model.boolean('open')
    if (open) open.value = Boolean(current.current.open)
    perform(
      model,
      current.current.sortingPhase ?? current.current.reaction ?? 'idle',
    )
  }

  const { rive, RiveComponent, container } = useRive(
    {
      buffer,
      artboard: 'Bill',
      stateMachine: 'Bill',
      autoBind: true,
      autoplay: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onRiveReady: initialize,
      onLoadError: () => setFailed(true),
      enableRiveAssetCDN: false,
    },
    {
      shouldUseIntersectionObserver: false,
      customDevicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    },
  )

  useEffect(() => {
    const model = rive?.viewModelInstance
    if (!model) return
    const open = model.boolean('open')
    if (open) open.value = Boolean(props.open)
    perform(model, props.sortingPhase ?? props.reaction ?? 'idle')
  }, [rive, props.open, props.reaction, props.reactionKey, props.sortingPhase])

  useEffect(() => {
    const model = rive?.viewModelInstance
    if (!rive || !model || !container) return
    let visible = true
    let frame = 0
    let lastTime = 0
    let gazeX = 0
    let gazeY = 0
    let lean = 0
    let wasDragging = false
    let releaseKey = interaction?.current.releaseKey ?? 0
    let personalityKey = interaction?.current.personalityKey ?? 0
    let temporaryUntil = 0
    let nextFlourish = performance.now() + 15_000 + Math.random() * 15_000
    const point = { x: 0, y: 0, active: false }
    const fine = window.matchMedia('(pointer: fine)')

    function move(event: PointerEvent) {
      if (!fine.matches || event.pointerType === 'touch') return
      point.x = event.clientX
      point.y = event.clientY
      point.active = true
    }
    function leave() {
      point.active = false
    }
    function tick(time: number) {
      if (!visible || document.hidden) return
      const delta = Math.min(time - lastTime || 16, 48)
      lastTime = time
      const state = interaction?.current
      const p = current.current
      const ambient =
        !p.open && !p.sortingPhase && (p.reaction ?? 'idle') === 'idle'
      const rect = container!.getBoundingClientRect()
      const targetX =
        point.active && ambient
          ? Math.max(
              -1,
              Math.min(1, (point.x - rect.left - rect.width / 2) / 250),
            )
          : 0
      const targetY =
        point.active && ambient
          ? Math.max(
              -1,
              Math.min(1, (point.y - rect.top - rect.height / 2) / 250),
            )
          : 0
      const blend = 1 - Math.exp(-delta / 100)
      gazeX += ((state?.gazeX ?? targetX) * 3 - gazeX) * blend
      gazeY += ((state?.gazeY ?? targetY) * 2 - gazeY) * blend
      const targetLean = state?.dragging
        ? Math.max(-0.18, Math.min(0.18, state.velocityX / 4000))
        : targetX * 0.035
      lean += (targetLean - lean) * blend
      number(model!, 'gazeX', gazeX)
      number(model!, 'gazeY', gazeY)
      number(model!, 'lean', lean)
      number(
        model!,
        'press',
        state?.pressed && !state.dragging
          ? 2
          : state?.hovered && ambient
            ? -1
            : 0,
      )
      if (state?.dragging && !wasDragging) {
        perform(model!, 'pickedUp')
        temporaryUntil = 0
      } else if (state && !state.dragging && state.releaseKey !== releaseKey) {
        perform(model!, 'settle')
        temporaryUntil = time + 700
        releaseKey = state.releaseKey
      } else if (ambient && state && state.personalityKey !== personalityKey) {
        const poses = ['welcome', 'wiggle', 'bashful'] as const
        const index = (state.personalityKey - 1) % poses.length
        perform(model!, poses[index])
        temporaryUntil = time + [2200, 1200, 1600][index]
        personalityKey = state.personalityKey
      } else if (
        ambient &&
        !state?.dragging &&
        time >= nextFlourish &&
        !temporaryUntil
      ) {
        perform(model!, 'stretch')
        temporaryUntil = time + 2400
        nextFlourish = time + 15_000 + Math.random() * 15_000
      } else if (temporaryUntil && time >= temporaryUntil && !state?.dragging) {
        perform(model!, p.sortingPhase ?? p.reaction ?? 'idle')
        temporaryUntil = 0
      }
      wasDragging = Boolean(state?.dragging)
      frame = requestAnimationFrame(tick)
    }
    function updateVisibility() {
      cancelAnimationFrame(frame)
      if (document.hidden || !visible) {
        rive!.stopRendering()
        return
      }
      lastTime = 0
      rive!.startRendering()
      frame = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      updateVisibility()
    })
    observer.observe(container)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', leave)
    document.documentElement.addEventListener('pointerleave', leave)
    document.addEventListener('visibilitychange', updateVisibility)
    updateVisibility()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('blur', leave)
      document.documentElement.removeEventListener('pointerleave', leave)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [rive, container, interaction])

  if (failed) return <BillFallback {...props} />
  return (
    <span className={className} aria-hidden="true" style={{ display: 'block' }}>
      <RiveComponent
        style={{
          width: '100%',
          height: '100%',
          transform: docked ? 'scale(0.78)' : undefined,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
    </span>
  )
}
