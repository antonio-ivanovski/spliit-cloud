/* oxlint-disable jsx-a11y/prefer-tag-over-role -- emoji and color swatches are custom-styled button radios inside explicit radiogroups. */
import { Ban, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  GROUP_COLOR_HEX,
  GROUP_COLOR_IDS,
  GROUP_EMOJI_CHOICES,
  isSingleEmoji,
  normalizeEmojiInput,
  normalizeHexColor,
} from '@spliit/domain'

const CUSTOM_EMOJI_TILE = 'custom-emoji'
const CUSTOM_COLOR_TILE = 'custom-color'

/**
 * Tracks whether a horizontal option row actually overflows so the edge fade
 * and end chevron only render while there is more to see in that direction.
 */
function useScrollHint() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const [isRtl, setIsRtl] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const maxOverflow = () => el.scrollWidth - el.clientWidth

    const updateEdges = () => {
      setIsRtl(getComputedStyle(el).direction === 'rtl')
      const max = maxOverflow()
      if (max <= 1) {
        setAtStart(true)
        setAtEnd(true)
        return
      }
      // RTL containers report negative scrollLeft in most browsers.
      const forward =
        getComputedStyle(el).direction === 'rtl'
          ? -el.scrollLeft
          : el.scrollLeft
      setAtStart(forward <= 1)
      setAtEnd(forward >= max - 1)
    }

    const onScroll = () => {
      updateEdges()
    }

    updateEdges()

    el.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  return { ref, atStart, atEnd, isRtl }
}

/**
 * Horizontally scrollable option row with hidden scrollbars, an edge fade
 * painted as a `mask-image` on the scroll container itself (no overlay to
 * misalign, no background color to mismatch in light or dark mode), and
 * chevrons at either edge while content extends beyond it. The chevrons are a
 * pointer affordance only — keyboard users already get arrow-key navigation on
 * the radiogroup — so it stays out of the tab order.
 */
function ScrollRow({
  label,
  onKeyDown,
  scrollContainerRef,
  children,
}: {
  label: string
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const { ref, atStart, atEnd, isRtl } = useScrollHint()
  // `atStart`/`atEnd` are logical (visual start = right in RTL); the mask
  // gradient and chevron are physical, so map them onto left/right.
  const leftFade = isRtl ? !atEnd : !atStart
  const rightFade = isRtl ? !atStart : !atEnd
  const startFade = isRtl ? rightFade : leftFade
  const endFade = isRtl ? leftFade : rightFade
  const FADE_PX = 32
  let maskImage: string | undefined
  if (leftFade && rightFade) {
    maskImage = `linear-gradient(to right, transparent, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), transparent)`
  } else if (leftFade) {
    maskImage = `linear-gradient(to right, transparent, black ${FADE_PX}px, black)`
  } else if (rightFade) {
    maskImage = `linear-gradient(to right, black, black calc(100% - ${FADE_PX}px), transparent)`
  }

  function scrollTowardEnd() {
    const el = ref.current
    if (!el) return
    const rtl = getComputedStyle(el).direction === 'rtl'
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({
      left: (rtl ? -1 : 1) * 96,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  function scrollTowardStart() {
    const el = ref.current
    if (!el) return
    const rtl = getComputedStyle(el).direction === 'rtl'
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({
      left: (rtl ? 1 : -1) * 96,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  return (
    <div className="relative">
      <div
        ref={(el) => {
          ref.current = el
          if (scrollContainerRef) scrollContainerRef.current = el
        }}
        role="radiogroup"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={
          maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined
        }
        className="-mx-1.5 scroll-x-fade flex items-center gap-1.5 overflow-x-auto px-1.5 py-1.5"
      >
        {children}
      </div>
      {startFade ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-0 flex items-center"
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={scrollTowardStart}
            className="pointer-events-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-full border bg-background text-muted-foreground shadow-sm"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </button>
        </span>
      ) : null}
      {endFade ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 end-0 flex items-center"
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={scrollTowardEnd}
            className="pointer-events-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-full border bg-background text-muted-foreground shadow-sm"
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </button>
        </span>
      ) : null}
    </div>
  )
}

/**
 * Inline emoji + color pickers for a group's appearance.
 *
 * `emoji` uses the persisted three-state convention: `undefined` means
 * untouched, `''` means explicitly none, anything else is the pick. `color`
 * follows the same shape with `null` as explicitly none and custom `#rrggbb`
 * strings alongside the palette ids. Picks apply immediately (no draft); the
 * trailing tile of each row expands an inline input for custom values.
 */
export function GroupAppearanceField({
  emoji,
  color,
  disabled = false,
  hint,
  onEmojiChange,
  onColorChange,
}: {
  emoji: string | undefined
  color: string | null | undefined
  disabled?: boolean
  hint?: ReactNode
  onEmojiChange: (value: string) => void
  onColorChange: (value: string | null | undefined) => void
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'GroupForm.Appearance',
  })
  const { t: tSchemaErrors } = useTranslation(undefined, {
    keyPrefix: 'SchemaErrors',
  })
  // The hex error only surfaces while typing once the value can plausibly be
  // complete; after a blocked submit it must show regardless, otherwise a
  // short invalid value silently refuses to submit.
  const { formState } = useFormContext()

  const curatedEmoji =
    typeof emoji === 'string' &&
    (GROUP_EMOJI_CHOICES as readonly string[]).includes(emoji)
      ? emoji
      : null
  const customEmojiValue =
    typeof emoji === 'string' && emoji !== '' && !curatedEmoji ? emoji : null
  const [customEmojiOpen, setCustomEmojiOpen] = useState(
    customEmojiValue !== null,
  )
  const customEmojiInputRef = useRef<HTMLInputElement | null>(null)
  const emojiNoneTileRef = useRef<HTMLButtonElement | null>(null)
  const emojiRowRef = useRef<HTMLDivElement | null>(null)
  // Tracks the last seen emoji so the row only scrolls on change — never on
  // mount (prefills) — and never steals focus, it just brings the tile into
  // view.
  const prevEmojiRef = useRef(emoji)

  useEffect(() => {
    const prev = prevEmojiRef.current
    prevEmojiRef.current = emoji
    if (!emoji || emoji === prev) return
    const container = emojiRowRef.current
    // Curated picks scroll to their tile; anything else (a transferred
    // custom emoji) scrolls to the trailing custom tile, which renders the
    // value.
    const tileKey = curatedEmoji ?? 'custom'
    const selector = `[data-emoji-tile="${typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(tileKey) : tileKey}"]`
    const tile = container?.querySelector<HTMLElement>(selector)
    if (!container || !tile || typeof container.scrollBy !== 'function') return
    const row = container.getBoundingClientRect()
    const box = tile.getBoundingClientRect()
    // Zero rects (jsdom, hidden) mean no layout to scroll.
    if (row.width === 0 && box.width === 0) return
    if (box.left >= row.left && box.right <= row.right) return
    const delta = box.left + box.width / 2 - (row.left + row.width / 2)
    if (Math.abs(delta) < 1) return
    const rtl = getComputedStyle(container).direction === 'rtl'
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Mirror the chevron helpers: RTL containers report negative scrollLeft
    // in most browsers, so the physical delta flips sign there.
    container.scrollBy({
      left: (rtl ? -1 : 1) * delta,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }, [emoji, curatedEmoji])

  const paletteSelection =
    typeof color === 'string' &&
    (GROUP_COLOR_IDS as readonly string[]).includes(color)
      ? color
      : null
  const customColorValue =
    typeof color === 'string' && color !== null && !paletteSelection
      ? (normalizeHexColor(color) ?? null)
      : null
  // Selection is value-based, not normalization-based: invalid text is
  // written through as-is (to block submit), and the tile must stay checked
  // while its input is open showing the error — mirroring the custom emoji
  // tile, which keys off the raw string.
  const customColorSelected =
    typeof color === 'string' && color !== '' && !paletteSelection
  const [customColorOpen, setCustomColorOpen] = useState(
    customColorValue !== null,
  )
  const [hexText, setHexText] = useState(customColorValue ?? '')
  const customColorInputRef = useRef<HTMLInputElement | null>(null)
  const colorNoneTileRef = useRef<HTMLButtonElement | null>(null)

  const hexValue = normalizeHexColor(hexText)
  const hexHasText = hexText.trim().length > 0
  const hexInvalid = hexHasText && hexValue === null
  // Only surface the error once the value can plausibly be complete; typing
  // `#` or `#f` on the way to `#ff0000` shouldn't flash an error. A blocked
  // submit sets isSubmitted, so short invalid input still gets an explanation.
  const showHexError =
    customColorOpen &&
    hexInvalid &&
    (hexText.trim().length >= 4 || formState.isSubmitted)
  const emojiInvalid =
    emoji !== undefined && emoji !== '' && !isSingleEmoji(emoji)

  function openCustomEmoji(event: MouseEvent<HTMLButtonElement>) {
    setCustomEmojiOpen(true)
    // Keyboard activation (Enter/Space or arrow-key clicks) leaves focus on
    // the tile so arrow navigation keeps working; pointer users land in the
    // input directly.
    if (event.detail > 0) customEmojiInputRef.current?.focus()
  }

  function openCustomColor(event: MouseEvent<HTMLButtonElement>) {
    if (!customColorOpen) setHexText(customColorValue ?? '')
    setCustomColorOpen(true)
    if (event.detail > 0) customColorInputRef.current?.focus()
  }

  function pickColor(next: string | null) {
    setCustomColorOpen(false)
    onColorChange(next)
  }

  function handleCustomEmojiChange(raw: string) {
    const normalized = normalizeEmojiInput(raw)
    // Clearing the input means "none": collapse back to the None tile so the
    // checked state, tab stop, and visible input stay in sync, and return
    // focus there — the input is unmounting.
    if (normalized === '') {
      setCustomEmojiOpen(false)
      emojiNoneTileRef.current?.focus()
    }
    onEmojiChange(normalized)
  }

  function handleHexChange(raw: string) {
    setHexText(raw)
    if (raw.trim() === '') {
      setCustomColorOpen(false)
      colorNoneTileRef.current?.focus()
      onColorChange(null)
      return
    }
    // Write invalid text through as-is so the form schema rejects it and
    // blocks submit; the inline error explains what to fix.
    onColorChange(normalizeHexColor(raw) ?? raw.trim())
  }

  /**
   * Minimal APG radio behavior for the scrollable option rows: arrows move
   * focus and select, Home/End jump. Keeps keyboard users from tabbing through
   * every emoji and makes the roving tabindex meaningful.
   */
  function handleRadioKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const handled = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
    ]
    if (!handled.includes(event.key)) return
    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not(:disabled)',
      ),
    )
    if (radios.length === 0) return
    const current = radios.indexOf(document.activeElement as HTMLButtonElement)
    // In RTL locales Left/Right are mirrored so navigation follows the visual
    // order; Up/Down are unaffected.
    const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const backKey = isRtl ? 'ArrowRight' : 'ArrowLeft'
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = radios.length - 1
    else if (event.key === backKey || event.key === 'ArrowUp') {
      next = current <= 0 ? radios.length - 1 : current - 1
    } else {
      next = current === -1 || current === radios.length - 1 ? 0 : current + 1
    }
    event.preventDefault()
    radios[next].focus()
    radios[next].click()
  }

  const emojiTabStop =
    emoji === ''
      ? ''
      : (curatedEmoji ??
        (customEmojiValue !== null || customEmojiOpen
          ? CUSTOM_EMOJI_TILE
          : GROUP_EMOJI_CHOICES[0]))
  const colorTabStop =
    paletteSelection ??
    (customColorValue !== null || customColorOpen
      ? CUSTOM_COLOR_TILE
      : color === null
        ? 'none'
        : GROUP_COLOR_IDS[0])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('emojiLabel')}</p>
        <ScrollRow
          label={t('emojiLabel')}
          onKeyDown={handleRadioKeyDown}
          scrollContainerRef={emojiRowRef}
        >
          <button
            type="button"
            role="radio"
            aria-checked={emoji === ''}
            aria-label={t('none')}
            tabIndex={emojiTabStop === '' ? 0 : -1}
            ref={emojiNoneTileRef}
            disabled={disabled}
            onClick={() => {
              setCustomEmojiOpen(false)
              onEmojiChange('')
            }}
            className={cn(
              'grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:cursor-not-allowed',
              emoji === ''
                ? 'bg-primary/10 ring-primary/40'
                : 'ring-transparent hover:bg-muted',
            )}
          >
            <Ban className="size-4" />
          </button>
          {GROUP_EMOJI_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={emoji === choice}
              aria-label={choice}
              data-emoji-tile={choice}
              tabIndex={emojiTabStop === choice ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                setCustomEmojiOpen(false)
                onEmojiChange(choice)
              }}
              className={cn(
                'grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-xl ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:cursor-not-allowed',
                emoji === choice
                  ? 'bg-primary/10 ring-primary/40'
                  : 'ring-transparent hover:bg-muted',
              )}
            >
              {choice}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={customEmojiValue !== null}
            aria-label={t('customEmojiTile')}
            data-emoji-tile="custom"
            tabIndex={emojiTabStop === CUSTOM_EMOJI_TILE ? 0 : -1}
            disabled={disabled}
            onClick={openCustomEmoji}
            className={cn(
              'grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-xl transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:cursor-not-allowed',
              customEmojiValue !== null
                ? 'bg-primary/10 ring-1 ring-primary/40 ring-inset'
                : 'border border-dashed border-muted-foreground/40 hover:bg-muted',
            )}
          >
            {customEmojiValue ?? <Plus className="size-4" />}
          </button>
        </ScrollRow>
        {customEmojiOpen ? (
          <div className="flex flex-col gap-1.5">
            <Input
              ref={customEmojiInputRef}
              value={customEmojiValue ?? ''}
              aria-label={t('customEmojiLabel')}
              placeholder={t('customEmojiPlaceholder')}
              className="w-full sm:w-60"
              disabled={disabled}
              aria-invalid={emojiInvalid}
              aria-describedby={
                emojiInvalid ? 'group-appearance-emoji-error' : undefined
              }
              onChange={(event) => handleCustomEmojiChange(event.target.value)}
            />
            {emojiInvalid ? (
              <p
                id="group-appearance-emoji-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {tSchemaErrors('invalidEmoji')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('colorLabel')}</p>
        <ScrollRow label={t('colorLabel')} onKeyDown={handleRadioKeyDown}>
          <button
            type="button"
            role="radio"
            aria-checked={color === null}
            aria-label={t('noColor')}
            tabIndex={colorTabStop === 'none' ? 0 : -1}
            ref={colorNoneTileRef}
            disabled={disabled}
            onClick={() => pickColor(null)}
            className={cn(
              'grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border bg-background text-muted-foreground ring-2 ring-offset-2 ring-offset-background transition focus-visible:ring-ring disabled:cursor-not-allowed',
              color === null
                ? 'ring-foreground/50'
                : 'ring-transparent hover:ring-foreground/20',
            )}
          >
            <Ban className="size-3.5" />
          </button>
          {GROUP_COLOR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={color === id}
              aria-label={t(`colors.${id}`)}
              tabIndex={colorTabStop === id ? 0 : -1}
              disabled={disabled}
              onClick={() => pickColor(id)}
              style={{ backgroundColor: GROUP_COLOR_HEX[id] }}
              className={cn(
                'size-9 shrink-0 cursor-pointer rounded-full ring-2 ring-offset-2 ring-offset-background transition focus-visible:ring-ring disabled:cursor-not-allowed',
                color === id
                  ? 'ring-foreground/50'
                  : 'ring-transparent hover:ring-foreground/20',
              )}
            />
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={customColorSelected}
            aria-label={t('customColorTile')}
            tabIndex={colorTabStop === CUSTOM_COLOR_TILE ? 0 : -1}
            disabled={disabled}
            onClick={openCustomColor}
            style={
              customColorValue
                ? { backgroundColor: customColorValue }
                : {
                    background:
                      'conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#8b5cf6,#f43f5e)',
                  }
            }
            className={cn(
              'grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-white ring-2 ring-offset-2 ring-offset-background transition focus-visible:ring-ring disabled:cursor-not-allowed',
              customColorSelected
                ? 'ring-foreground/50'
                : 'ring-transparent hover:ring-foreground/20',
            )}
          >
            {customColorValue ? null : (
              <Plus className="size-3.5 drop-shadow" />
            )}
          </button>
        </ScrollRow>
        {customColorOpen ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="group-appearance-hex"
              className="text-xs text-muted-foreground"
            >
              {t('customColorLabel')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                style={hexValue ? { backgroundColor: hexValue } : undefined}
                className={cn(
                  'size-9 shrink-0 rounded-full border',
                  hexValue
                    ? 'border-transparent'
                    : 'border-dashed border-muted-foreground/40',
                )}
              />
              <Input
                ref={customColorInputRef}
                id="group-appearance-hex"
                value={hexText}
                placeholder={t('customColorPlaceholder')}
                className="w-32 font-mono uppercase"
                disabled={disabled}
                spellCheck={false}
                aria-invalid={showHexError}
                aria-describedby={
                  showHexError ? 'group-appearance-hex-error' : undefined
                }
                onChange={(event) => handleHexChange(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                {t('customColorHint')}
              </span>
            </div>
            {showHexError ? (
              <p
                id="group-appearance-hex-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {tSchemaErrors('invalidColor')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
