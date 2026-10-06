import {
  Carrot,
  Clapperboard,
  HousePlus,
  Plane,
  UtensilsCrossed,
} from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BillCharacter,
  type BillSortingPhase,
} from '@/components/mascot/characters/bill/bill-character'

import {
  advanceSortingStack,
  initialSortingStack,
  SORTING_CATEGORIES,
  type SortingCategory,
  type SortingReceipt,
  type SortingTitle,
} from './bulk-categorize-scene-sequence'
import { sortingPresetTitles } from './bulk-categorize-scene-titles'

import './bulk-categorize-progress-scene.css'

const clues = {
  groceries: {
    Icon: Carrot,
    label: 'Categories.Food and Drink.Groceries',
  },
  dining: {
    Icon: UtensilsCrossed,
    label: 'Categories.Food and Drink.Dining Out',
  },
  plane: { Icon: Plane, label: 'Categories.Transportation.Plane' },
  household: { Icon: HousePlus, label: 'Categories.Home.Household Supplies' },
  movies: { Icon: Clapperboard, label: 'Categories.Entertainment.Movies' },
} as const

const stackLayers = [
  'front',
  'middle',
  'back',
  'rear',
  'hidden',
  'hidden',
] as const

function centerInScene(scene: HTMLElement, element: HTMLElement) {
  const sceneRect = scene.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left - sceneRect.left + rect.width / 2,
    y: rect.top - sceneRect.top + rect.height / 2,
  }
}

function positionFor(
  scene: HTMLElement,
  receipt: HTMLElement,
  anchor: HTMLElement,
) {
  const center = centerInScene(scene, anchor)
  return {
    x: center.x - receipt.offsetWidth / 2,
    y: center.y - receipt.offsetHeight / 2,
  }
}

function transform(x: number, y: number, scale = 1) {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`
}

export function receiptBottomClip(
  top: number,
  height: number,
  scale: number,
  trayBottom: number,
) {
  // The receipt scales around a point 75% down its height. Leave a small
  // allowance for the paper shadow.
  const lowerEdge = top + height * (0.75 + 0.25 * scale)
  return Math.max(0, Math.min(height, (lowerEdge - trayBottom + 6) / scale))
}

const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * progress

function ReceiptPaper({ receipt }: { receipt: SortingReceipt }) {
  return (
    <div
      className="bill-sort-scene__receipt-paper"
      data-category={receipt.category}
    >
      <span className="bill-sort-scene__receipt-fold" />
      <span className="bill-sort-scene__receipt-heading">{receipt.title}</span>
      <span className="bill-sort-scene__receipt-id">№ 018</span>
      <span className="bill-sort-scene__receipt-rule" />
      <span className="bill-sort-scene__receipt-rule bill-sort-scene__receipt-rule--short" />
      <span className="bill-sort-scene__receipt-total">TOTAL</span>
    </div>
  )
}

function ReceiptClue({ category }: { category: SortingCategory }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg viewBox="0 0 48 48" focusable="false" aria-hidden="true">
      {category === 'groceries' && (
        <g {...common}>
          <path
            d="M19 17c-3 0-5 2-5 5 0 4 5 14 8 17 3-3 8-13 8-17 0-3-2-5-5-5"
            fill="currentColor"
            fillOpacity=".18"
          />
          <path d="M22 18c-5-3-6-8-5-10 4 0 7 3 7 7M24 18c1-5 4-8 8-8-1 4-3 7-8 8" />
          <path d="M16 25h11M18 30h7" strokeOpacity=".65" />
          <circle cx="33" cy="30" r="5" fill="currentColor" fillOpacity=".2" />
          <path d="M31 25c1-3 3-4 5-4" />
        </g>
      )}
      {category === 'dining' && (
        <g {...common}>
          <path
            d="M13 25a11 7 0 0 0 22 0M13 25a11 7 0 0 1 22 0"
            fill="currentColor"
            fillOpacity=".15"
          />
          <path d="M17 33h14M13 15v9M10 15v5M16 15v5M36 15v18" />
          <path d="M22 9c-3 3 2 5-1 8M28 9c-3 3 2 5-1 8" strokeOpacity=".65" />
        </g>
      )}
      {category === 'plane' && (
        <g {...common}>
          <path
            d="M8 14h32v8c-3 0-3 4 0 4v8H8v-8c3 0 3-4 0-4z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path d="M16 14v20M19 29c4-7 9-10 15-8" strokeDasharray="2 2" />
          <path
            d="m29 17 6 3-5 5m5-5-7 1"
            fill="currentColor"
            fillOpacity=".28"
          />
          <path d="M21 19h4M21 23h3" strokeOpacity=".6" />
        </g>
      )}
      {category === 'household' && (
        <g {...common}>
          <path d="M19 19h13l2 19H17z" fill="currentColor" fillOpacity=".14" />
          <path d="M22 18v-5h8v5M25 13V9h9M18 25h15" />
          <path
            d="m11 15 1-3 1 3 3 1-3 1-1 3-1-3-3-1z"
            fill="currentColor"
            fillOpacity=".22"
          />
          <path d="m38 10 1-2 1 2 2 1-2 1-1 2-1-2-2-1z" />
          <path d="M23 30h5" strokeOpacity=".65" />
        </g>
      )}
      {category === 'movies' && (
        <g {...common}>
          <path
            d="M8 17h32v7c-3 0-3 4 0 4v7H8v-7c3 0 3-4 0-4z"
            fill="currentColor"
            fillOpacity=".13"
          />
          <path
            d="M16 17v18M20 21h15M20 31h15"
            strokeDasharray="2 2"
            strokeOpacity=".7"
          />
          <path
            d="m27 22 1.6 3.1 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.5-2.4 3.4-.5z"
            fill="currentColor"
            fillOpacity=".28"
          />
        </g>
      )}
    </svg>
  )
}

function SortingScene({
  titles,
  onAnimationError,
}: {
  titles?: readonly SortingTitle[]
  onAnimationError: () => void
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const presets = useMemo(() => sortingPresetTitles(t), [t])
  const availableTitles = titles?.length ? titles : presets
  const sceneRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)
  const billRef = useRef<HTMLDivElement>(null)
  const receiptRefs = useRef(new Map<number, HTMLDivElement>())
  const ideaRef = useRef<HTMLDivElement>(null)
  const armsRef = useRef<SVGSVGElement>(null)
  const handsRef = useRef<SVGSVGElement>(null)
  const leftArmRef = useRef<SVGPathElement>(null)
  const rightArmRef = useRef<SVGPathElement>(null)
  const leftHandRef = useRef<SVGCircleElement>(null)
  const rightHandRef = useRef<SVGCircleElement>(null)
  const leftThumbRef = useRef<SVGPathElement>(null)
  const rightThumbRef = useRef<SVGPathElement>(null)
  const trayRefs = useRef<Partial<Record<SortingCategory, HTMLDivElement>>>({})
  const [sequence, setSequence] = useState(() =>
    initialSortingStack(availableTitles),
  )
  const sequenceRef = useRef(sequence)
  const titleSourceRef = useRef(availableTitles)
  const pendingTitlesRef = useRef<readonly SortingTitle[] | null>(null)
  const stack = sequence.stack
  const [billPhase, setBillPhase] = useState<BillSortingPhase>('waiting')
  const [activeTray, setActiveTray] = useState<SortingCategory | null>(null)
  const [layoutVersion, setLayoutVersion] = useState(0)
  useEffect(() => {
    if (titleSourceRef.current === availableTitles) return
    titleSourceRef.current = availableTitles
    pendingTitlesRef.current = availableTitles
  }, [availableTitles])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || typeof ResizeObserver === 'undefined') return
    let width = scene.clientWidth
    const observer = new ResizeObserver(() => {
      if (scene.clientWidth === width) return
      width = scene.clientWidth
      setLayoutVersion((value) => value + 1)
    })
    observer.observe(scene)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    const source = sourceRef.current
    const bill = billRef.current
    const receipt = receiptRefs.current.get(sequenceRef.current.stack[0].id)
    const idea = ideaRef.current
    const arms = armsRef.current
    const hands = handsRef.current
    const leftArm = leftArmRef.current
    const rightArm = rightArmRef.current
    const leftHand = leftHandRef.current
    const rightHand = rightHandRef.current
    const leftThumb = leftThumbRef.current
    const rightThumb = rightThumbRef.current
    if (
      !scene ||
      !source ||
      !bill ||
      !receipt ||
      !idea ||
      !arms ||
      !hands ||
      !leftArm ||
      !rightArm ||
      !leftHand ||
      !rightHand ||
      !leftThumb ||
      !rightThumb
    )
      return
    if (reducedMotion) return

    const sceneWidth = scene.clientWidth
    const sceneHeight = scene.clientHeight
    const sceneRect = scene.getBoundingClientRect()
    const receiptWidth = receipt.offsetWidth
    const receiptHeight = receipt.offsetHeight
    const billWidth = bill.offsetWidth
    const from = positionFor(scene, receipt, source)
    const destinations = Object.fromEntries(
      SORTING_CATEGORIES.map((item) => {
        const tray = trayRefs.current[item]
        return [
          item,
          tray
            ? {
                ...positionFor(scene, receipt, tray),
                bottom: tray.getBoundingClientRect().bottom - sceneRect.top,
              }
            : null,
        ]
      }),
    ) as Record<
      SortingCategory,
      { x: number; y: number; bottom: number } | null
    >
    const held = {
      x: sceneWidth / 2 - receiptWidth / 2,
      y: bill.offsetTop + bill.offsetHeight * 0.62,
    }
    const shoulderY = bill.offsetTop + bill.offsetHeight * 0.53
    const restCenter = bill.offsetLeft
    const shoulderOffset = billWidth * 0.21
    arms.setAttribute('viewBox', `0 0 ${sceneWidth} ${sceneHeight}`)
    hands.setAttribute('viewBox', `0 0 ${sceneWidth} ${sceneHeight}`)

    let stopped = false
    let frameId = 0
    let lastTime = 0
    let elapsed = 0
    let next = sequenceRef.current.stack[0]
    let shownPhase: BillSortingPhase | null = null
    let shownTray: SortingCategory | null = null
    receipt.style.transform = transform(0, 0)
    receipt.style.opacity = '1'
    receipt.style.clipPath = 'none'
    idea.style.opacity = '0'
    receipt.style.visibility = 'visible'

    const draw = (time: number) => {
      if (stopped || document.hidden) return
      const delta = lastTime ? Math.min(48, time - lastTime) : 0
      lastTime = time
      elapsed += delta
      const cycleEnd = next.delay + 2950
      if (elapsed >= cycleEnd) {
        elapsed = 0
        const following = advanceSortingStack(
          sequenceRef.current,
          pendingTitlesRef.current,
        )
        pendingTitlesRef.current = null
        sequenceRef.current = following
        next = following.stack[0]
        idea.style.opacity = '0'
        setSequence(following)
        setActiveTray(null)
        shownTray = null
        receipt.style.clipPath = 'none'
        schedule()
        return
      }

      const destination = destinations[next.category]
      const activeReceipt = receiptRefs.current.get(next.id)
      if (!destination || !activeReceipt) {
        schedule()
        return
      }
      const t = elapsed - next.delay
      const reach = ease(t / 380)
      const lift = ease((t - 380) / 420)
      const carry = ease((t - 1640) / 650)
      const insert = ease((t - 2290) / 320)
      const returnHome = ease((t - 2630) / 290)
      const filing = carry > 0
      const reading = lift >= 1 && !filing
      const phase: BillSortingPhase =
        t < 0
          ? 'waiting'
          : lift < 1
            ? 'catching'
            : reading
              ? 'reading'
              : 'filing'
      if (phase !== shownPhase) {
        shownPhase = phase
        setBillPhase(phase)
      }

      // The same sheet is drawn at the stack, in both hands, and under the tray lip.
      const liftX = mix(from.x, held.x, lift)
      const liftY = mix(from.y, held.y, lift)
      const fileX = mix(liftX, destination.x, carry)
      const fileY = mix(liftY, destination.y - 13, carry)
      const x = fileX + Math.sin(carry * Math.PI) * next.drift * 0.15
      const y = fileY + insert * 19
      const receiptScale = 1 - insert * 0.13
      activeReceipt.style.transform = transform(
        x - from.x,
        y - from.y,
        receiptScale,
      )
      activeReceipt.style.clipPath =
        carry > 0.9
          ? `inset(0 0 ${receiptBottomClip(y, receiptHeight, receiptScale, destination.bottom)}px 0)`
          : 'none'
      activeReceipt.style.opacity = String(1 - ease((insert - 0.67) / 0.33))
      idea.style.opacity = String(
        ease((t - 1110) / 180) * (1 - ease((t - 1630) / 170)),
      )
      if (insert > 0 && shownTray !== next.category) {
        shownTray = next.category
        setActiveTray(next.category)
      }

      // Both hand tips are derived from this frame's receipt position.
      const leftGrip = { x: x + receiptWidth * 0.15, y: y + 28 }
      const rightGrip = { x: x + receiptWidth * 0.85, y: y + 28 }
      const pileGrip = { x: from.x + receiptWidth * 0.82, y: from.y + 22 }
      const pickupCenter = pileGrip.x + shoulderOffset + 18
      const trayCenter = destination.x + receiptWidth / 2
      const bodyAtPickup = mix(restCenter, pickupCenter, reach)
      const bodyAtRead = mix(bodyAtPickup, restCenter, lift)
      const bodyAtTray = mix(bodyAtRead, trayCenter, carry)
      const bodyCenter = Math.max(
        billWidth / 2 + 4,
        Math.min(
          sceneWidth - billWidth / 2 - 4,
          mix(bodyAtTray, restCenter, returnHome),
        ),
      )
      const travel = bodyCenter - restCenter
      bill.style.transform = `translateX(calc(-50% + ${travel}px)) rotate(${filing ? Math.sin(carry * Math.PI) * 2 : -1.5 * reach * (1 - lift)}deg)`
      const shoulderX = bodyCenter
      const leftShoulder = {
        x: shoulderX - shoulderOffset,
        y: shoulderY,
      }
      const rightShoulder = {
        x: shoulderX + shoulderOffset,
        y: shoulderY,
      }
      const leftRest = { x: leftShoulder.x - 21, y: shoulderY + 12 }
      const rightRest = { x: rightShoulder.x + 21, y: shoulderY + 12 }
      const release = ease(insert / 0.75)
      const leftTarget =
        t < 380
          ? {
              x: mix(leftRest.x, pileGrip.x, reach),
              y: mix(leftRest.y, pileGrip.y, reach),
            }
          : lift < 1
            ? {
                x: mix(pileGrip.x, leftGrip.x, lift),
                y: mix(pileGrip.y, leftGrip.y, lift),
              }
            : {
                x: mix(leftGrip.x, leftRest.x, release),
                y: mix(leftGrip.y, leftRest.y, release),
              }
      const rightTarget = {
        x: mix(mix(rightRest.x, rightGrip.x, lift), rightRest.x, release),
        y: mix(mix(rightRest.y, rightGrip.y, lift), rightRest.y, release),
      }
      const drawArm = (
        path: SVGPathElement,
        shoulder: typeof leftShoulder,
        hand: typeof leftTarget,
      ) => {
        const bend = shoulder.x < hand.x ? 10 : -10
        path.setAttribute(
          'd',
          `M${shoulder.x} ${shoulder.y} Q${mix(shoulder.x, hand.x, 0.54) + bend} ${mix(shoulder.y, hand.y, 0.48) - 8} ${hand.x} ${hand.y}`,
        )
      }
      drawArm(leftArm, leftShoulder, leftTarget)
      drawArm(rightArm, rightShoulder, rightTarget)
      leftHand.setAttribute('cx', String(leftTarget.x))
      leftHand.setAttribute('cy', String(leftTarget.y))
      rightHand.setAttribute('cx', String(rightTarget.x))
      rightHand.setAttribute('cy', String(rightTarget.y))
      leftThumb.setAttribute(
        'd',
        `M${leftTarget.x - 1} ${leftTarget.y + 2} Q${leftTarget.x + 3} ${leftTarget.y + 8} ${leftTarget.x + 7} ${leftTarget.y + 3}`,
      )
      rightThumb.setAttribute(
        'd',
        `M${rightTarget.x + 1} ${rightTarget.y + 2} Q${rightTarget.x - 3} ${rightTarget.y + 8} ${rightTarget.x - 7} ${rightTarget.y + 3}`,
      )
      schedule()
    }

    const fail = (error: unknown) => {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      console.error('Bill sorting animation failed', error)
      onAnimationError()
    }
    const tick = (time: number) => {
      try {
        draw(time)
      } catch (error) {
        fail(error)
      }
    }
    const schedule = () => {
      try {
        frameId = requestAnimationFrame(tick)
      } catch (error) {
        fail(error)
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameId)
        lastTime = 0
      } else if (!stopped) {
        schedule()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (!document.hidden) schedule()
    return () => {
      stopped = true
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [layoutVersion, onAnimationError, reducedMotion])

  return (
    <div className="bill-sort-scene-frame">
      <div
        className="bill-sort-scene"
        aria-hidden="true"
        data-testid="bill-sort-scene"
      >
        <div className="bill-sort-scene__workspace" ref={sceneRef}>
          <div className="bill-sort-scene__desk" />
          <div className="bill-sort-scene__incoming" ref={sourceRef} />
          {[...stack].reverse().map((receipt, reverseIndex) => {
            const index = stack.length - reverseIndex - 1
            return (
              <div
                key={receipt.id}
                ref={(node) => {
                  if (node) receiptRefs.current.set(receipt.id, node)
                  else receiptRefs.current.delete(receipt.id)
                }}
                className={
                  index === 0
                    ? 'bill-sort-scene__paper bill-sort-scene__receipt'
                    : `bill-sort-scene__paper bill-sort-scene__stack-sheet bill-sort-scene__stack-sheet--${stackLayers[index - 1]}`
                }
                data-receipt-id={receipt.id}
                data-category={receipt.category}
              >
                <ReceiptPaper receipt={receipt} />
              </div>
            )
          })}
          <svg
            className="bill-sort-scene__arms"
            ref={armsRef}
            aria-hidden="true"
          >
            <path ref={leftArmRef} />
            <path ref={rightArmRef} />
          </svg>
          <div className="bill-sort-scene__bill" ref={billRef}>
            <BillCharacter
              sortingPhase={reducedMotion ? 'reading' : billPhase}
              sortingArms={false}
              className="bill-sort-scene__bill-art"
            />
            <div
              className="bill-sort-scene__idea"
              ref={ideaRef}
              data-category={stack[0].category}
            >
              <span className="bill-sort-scene__idea-icon">
                <ReceiptClue category={stack[0].category} />
              </span>
              <span className="bill-sort-scene__idea-label">
                {t(clues[stack[0].category].label)}
              </span>
            </div>
          </div>
          <svg
            className="bill-sort-scene__hands"
            ref={handsRef}
            aria-hidden="true"
          >
            <circle ref={leftHandRef} r="5" />
            <circle ref={rightHandRef} r="5" />
            <path ref={leftThumbRef} />
            <path ref={rightThumbRef} />
          </svg>
          <div className="bill-sort-scene__trays">
            {SORTING_CATEGORIES.map((item) => {
              const Icon = clues[item].Icon
              return (
                <div
                  key={item}
                  className="bill-sort-scene__tray"
                  data-category={item}
                  data-active={activeTray === item ? 'true' : undefined}
                  ref={(node) => {
                    if (node) trayRefs.current[item] = node
                    else delete trayRefs.current[item]
                  }}
                >
                  <span className="bill-sort-scene__tray-back" />
                  <span className="bill-sort-scene__tray-filed bill-sort-scene__tray-filed--one" />
                  <span className="bill-sort-scene__tray-filed bill-sort-scene__tray-filed--two" />
                  <span className="bill-sort-scene__tray-front" />
                  <span className="bill-sort-scene__tray-inner">
                    <Icon strokeWidth={1.8} />
                  </span>
                  <span className="bill-sort-scene__tray-label">
                    {t(clues[item].label)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

class SortingSceneBoundary extends Component<
  { titles?: readonly SortingTitle[] },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  private fail = () => this.setState({ failed: true })

  render() {
    if (this.state.failed) return null
    return (
      <SortingScene titles={this.props.titles} onAnimationError={this.fail} />
    )
  }
}

export function BulkCategorizeProgressScene({
  titles,
}: {
  titles?: readonly SortingTitle[]
}) {
  return <SortingSceneBoundary titles={titles} />
}
