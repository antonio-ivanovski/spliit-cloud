/**
 * Halloween season scenery — "Haunted House" direction.
 *
 * Two purely decorative plates that live behind every route:
 *
 * 1. `.halloween-scenery` — a fixed viewport plate (moon, cobwebs, drifting fog,
 *    dust motes and the ghost-sheet Bill). It never scrolls, so the mood stays
 *    with the reader on long pages.
 * 2. `.halloween-ground` — a document-anchored plate (haunted house, dead tree,
 *    jack-o'-lanterns) standing on a line just above the footer, so the
 *    silhouettes read as "the house behind the footer band".
 *
 * Contract with the shell:
 *
 * - Both plates are `aria-hidden` + `pointer-events: none`, so they can never
 *   intercept a click, a focus ring or a screen-reader pass.
 * - They are only _displayed_ while `html[data-season="halloween"]` is set (see
 *   `styles/halloween.css`). Turning the season off removes every trace of the
 *   theme — markup included.
 * - All motion is CSS keyframes. No timers, no JS animation, no layout reads.
 *   `prefers-reduced-motion: reduce` swaps in a static composition.
 *
 * Layering (see the CSS file for the full contract): -1 scenery + ground → 0
 * ambient wash → 20 content 50 app header
 */

/* ── Cobweb geometry ─────────────────────────────────────────────────── */

const WEB_RADIUS = 100
const WEB_SPOKES = 7
const WEB_RINGS = 4

/**
 * A corner cobweb: straight strands from the corner plus sagging arcs between
 * them. Generated once at module scope — the shape never changes, so there is
 * nothing to recompute on render.
 */
function buildCobweb() {
  const strands: string[] = []
  const arcs: string[] = []

  for (let spoke = 0; spoke <= WEB_SPOKES; spoke++) {
    const angle = (spoke / WEB_SPOKES) * (Math.PI / 2)
    strands.push(
      `M0 0L${(WEB_RADIUS * Math.cos(angle)).toFixed(2)} ${(
        WEB_RADIUS * Math.sin(angle)
      ).toFixed(2)}`,
    )
  }

  for (let ring = 1; ring <= WEB_RINGS; ring++) {
    const radius = (WEB_RADIUS * ring) / WEB_RINGS
    let arc = ''
    for (let spoke = 0; spoke < WEB_SPOKES; spoke++) {
      const from = (spoke / WEB_SPOKES) * (Math.PI / 2)
      const to = ((spoke + 1) / WEB_SPOKES) * (Math.PI / 2)
      const x1 = radius * Math.cos(from)
      const y1 = radius * Math.sin(from)
      const x2 = radius * Math.cos(to)
      const y2 = radius * Math.sin(to)
      // Control point pushed past the chord so the strand sags outwards.
      const cx = ((x1 + x2) / 2) * 1.12
      const cy = ((y1 + y2) / 2) * 1.12
      arc += `${spoke === 0 ? `M${x1.toFixed(2)} ${y1.toFixed(2)} ` : ''}Q${cx.toFixed(
        2,
      )} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} `
    }
    arcs.push(arc.trim())
  }

  return { strands, arcs }
}

const COBWEB = buildCobweb()

function Cobweb({ corner }: { corner: 'top-left' | 'bottom-right' }) {
  return (
    <svg
      className={`halloween-scenery__web halloween-scenery__web--${corner}`}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeLinecap="round">
        {COBWEB.strands.map((strand) => (
          <path key={strand} d={strand} strokeWidth="0.9" />
        ))}
        {COBWEB.arcs.map((arc) => (
          <path key={arc} d={arc} strokeWidth="0.7" />
        ))}
      </g>
    </svg>
  )
}

/* ── Ghost-sheet Bill ────────────────────────────────────────────────── */

/**
 * The signature of the season: Bill wearing a sheet ghost costume. The costume
 * keeps his ink face and lets the split down the middle of the receipt show
 * through, so it still reads as _Bill_ and not as a generic ghost. Drawn flat,
 * no filters — the glow is a CSS drop-shadow.
 */
function GhostBill() {
  return (
    <svg
      className="halloween-scenery__ghost"
      viewBox="0 0 100 128"
      aria-hidden="true"
      focusable="false"
    >
      {/* Sheet: a domed head over a scalloped hem. */}
      <path
        d="M50 4C26 4 14 20 14 38c0 14-4 28-3 44 1 16 6 28 13 30 6 2 7-8 13-8 6 0 7 12 13 12s7-12 13-12c6 0 7 10 13 8 7-2 12-14 13-30 1-16-3-30-3-44C86 20 74 4 50 4Z"
        className="halloween-ghost__sheet"
      />
      {/* Bill's receipt seam and rules, seen through the sheet. */}
      <path
        d="M50 10v96"
        className="halloween-ghost__seam"
        strokeDasharray="5 5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M33 74h34M33 84h34M36 94h28"
        className="halloween-ghost__rule"
        strokeLinecap="round"
        fill="none"
      />
      {/* Face. */}
      <ellipse
        cx="38"
        cy="47"
        rx="5"
        ry="6.5"
        className="halloween-ghost__ink"
      />
      <ellipse
        cx="62"
        cy="47"
        rx="5"
        ry="6.5"
        className="halloween-ghost__ink"
      />
      <path
        d="M39 65q11 9 22 0"
        className="halloween-ghost__stroke"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Arms poking out of the sheet. */}
      <path
        d="M15 62c-7 3-10 10-8 18"
        className="halloween-ghost__arm"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M85 62c7 3 10 10 8 18"
        className="halloween-ghost__arm"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

/* ── The haunted house ───────────────────────────────────────────────── */

/** Arched window: straight jambs, a semicircular head. */
function archedWindow(x: number, y: number, width = 18, height = 26) {
  const radius = width / 2
  return `M${x} ${y + height}v${-(height - radius)}a${radius} ${radius} 0 0 1 ${width} 0v${height - radius}z`
}

/**
 * The house that gives the season its name: a crooked gable, a leaning tower
 * with a weathervane, a chimney and candle-lit windows. The whole silhouette is
 * one tone so it reads as a cut-out against the aged paper; only the windows
 * carry light.
 */
function HauntedHouse() {
  return (
    <svg
      className="halloween-ground__house halloween-ground__house--main"
      viewBox="0 0 200 112"
      aria-hidden="true"
      focusable="false"
    >
      {/* Chimney, behind the roof. */}
      <path d="M52 14h11v30H52z" className="halloween-house__mass" />
      {/* Tower. */}
      <path d="M122 112V46h28v66z" className="halloween-house__mass" />
      <path
        d="M112 48 135 16l23 28-6 6-17-24-17 28z"
        className="halloween-house__mass"
      />
      {/* Weathervane on the tower peak. */}
      <path
        d="M135 16V6m-7 4h14m-4-4 5 4-5 4"
        className="halloween-house__vane"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Main wall + gable. */}
      <path d="M40 112V56h82v56z" className="halloween-house__mass" />
      <path
        d="M26 58 84 8l46 44-7 8-39-36-52 40z"
        className="halloween-house__mass"
      />
      {/* Stepping stone under the door. */}
      <path d="M72 108h30v4H72z" className="halloween-house__mass" />

      <g className="halloween-house__windows">
        {/* Attic round window. */}
        <circle cx="84" cy="42" r="7.5" className="halloween-house__window" />
        <path d="M76.5 42h15M84 34.5v15" className="halloween-house__mullion" />
        {/* Body windows. */}
        <path d={archedWindow(52, 72)} className="halloween-house__window" />
        <path d="M61 64v26M52 78h18" className="halloween-house__mullion" />
        <path d={archedWindow(92, 72)} className="halloween-house__window" />
        <path d="M101 64v26M92 78h18" className="halloween-house__mullion" />
        {/* Tower window. */}
        <path
          d={archedWindow(128, 62, 14, 22)}
          className="halloween-house__window"
        />
        <path d="M135 55v22" className="halloween-house__mullion" />
      </g>
    </svg>
  )
}

/** A smaller, further house — depth behind the main silhouette. */
function FarHouse() {
  return (
    <svg
      className="halloween-ground__house halloween-ground__house--far"
      viewBox="0 0 140 100"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M40 100V56h60v44z" className="halloween-house__mass" />
      <path
        d="M28 58 68 16l46 40-6 6-40-34-34 36z"
        className="halloween-house__mass"
      />
      <path d="M96 100V48h16v52z" className="halloween-house__mass" />
      <path
        d="M90 50 104 26l14 22-5 4-9-14-9 16z"
        className="halloween-house__mass"
      />
      <g className="halloween-house__windows">
        <path
          d={archedWindow(48, 66, 14, 22)}
          className="halloween-house__window"
        />
        <path
          d={archedWindow(78, 66, 14, 22)}
          className="halloween-house__window"
        />
        <path
          d={archedWindow(99, 60, 10, 18)}
          className="halloween-house__window"
        />
      </g>
    </svg>
  )
}

/** A dead tree: the only thing that breaks the roofline. */
function DeadTree() {
  return (
    <svg
      className="halloween-ground__tree"
      viewBox="0 0 90 112"
      aria-hidden="true"
      focusable="false"
    >
      <g className="halloween-tree__branches" strokeLinecap="round" fill="none">
        <path d="M45 112c-1-26 2-42-2-60-1-8-3-14-6-20" strokeWidth="8" />
        <path d="M43 70c-7-5-13-8-21-8" strokeWidth="4.4" />
        <path d="M43 82c8-4 15-5 23-3" strokeWidth="4.4" />
        <path d="M42 56c-6-8-9-17-9-26" strokeWidth="3.8" />
        <path d="M40 44c6-4 11-11 13-19" strokeWidth="3.2" />
        <path d="M36 32c-5-5-7-12-6-19" strokeWidth="2.6" />
        <path d="M63 79c4-4 6-9 6-15" strokeWidth="2.4" />
        <path d="M22 62c-3-4-4-9-3-14" strokeWidth="2.2" />
        <path d="M68 78c3-6 4-11 3-17" strokeWidth="2.2" />
      </g>
    </svg>
  )
}

/** A jack-o'-lantern: pumpkin body with a lit, carved face. */
function Pumpkin({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 44 36"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M22 9c-9 0-18 6-18 13 0 6 7 11 18 11s18-5 18-11c0-7-9-13-18-13Z"
        className="halloween-pumpkin__body"
      />
      <path
        d="M15 11c-3 6-3 12 0 19M22 9v24M29 11c3 6 3 12 0 19"
        className="halloween-pumpkin__ridge"
        fill="none"
      />
      <path
        d="M20 9c0-4 1-6 4-7"
        className="halloween-pumpkin__stem"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <g className="halloween-pumpkin__face">
        <path d="M12 17l6 4-6 4z" />
        <path d="M26 17l6 4-6 4z" />
        <path d="M12 27l5-3 3 4 4-4 3 4 5-3-1 5H13z" />
      </g>
    </svg>
  )
}

/* ── The plates ──────────────────────────────────────────────────────── */

/**
 * Renders the Halloween scenery. Mounted once by the app shell; the theme
 * itself is switched by the `data-season` attribute on `<html>`.
 */
export function HalloweenScenery() {
  return (
    <>
      <div className="halloween-scenery" aria-hidden="true">
        <div className="halloween-scenery__grain" />
        <div className="halloween-scenery__sky" />
        <div className="halloween-scenery__stars" />
        <div className="halloween-scenery__moon" />
        <div className="halloween-scenery__motes">
          <span className="halloween-scenery__mote halloween-scenery__mote--1" />
          <span className="halloween-scenery__mote halloween-scenery__mote--2" />
          <span className="halloween-scenery__mote halloween-scenery__mote--3" />
          <span className="halloween-scenery__mote halloween-scenery__mote--4" />
        </div>
        <div className="halloween-scenery__fog halloween-scenery__fog--far" />
        <div className="halloween-scenery__fog halloween-scenery__fog--near" />
        <Cobweb corner="top-left" />
        <Cobweb corner="bottom-right" />
        <GhostBill />
      </div>

      <div className="halloween-ground" aria-hidden="true">
        <svg
          className="halloween-ground__hill"
          viewBox="0 0 1200 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M0 100V40Q140 8 320 22Q520 36 700 12Q900 4 1060 18Q1140 24 1200 14v86Z"
            fill="currentColor"
          />
          {/* Moonlight catching the ridge. */}
          <path
            d="M0 40Q140 8 320 22Q520 36 700 12Q900 4 1060 18Q1140 24 1200 14"
            className="halloween-ground__ridge"
            fill="none"
          />
        </svg>
        <DeadTree />
        <HauntedHouse />
        <Pumpkin className="halloween-ground__pumpkin halloween-ground__pumpkin--a" />
        <FarHouse />
        <Pumpkin className="halloween-ground__pumpkin halloween-ground__pumpkin--b" />
      </div>
    </>
  )
}
