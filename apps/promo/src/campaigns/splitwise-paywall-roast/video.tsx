import {
  ArrowUpRight,
  Check,
  GitFork,
  Pizza,
  ArrowLeftRight,
  ChartColumn,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  ListChecks,
  QrCode,
  Repeat,
  Search,
  Server,
  Users,
  Wallet,
  PieChart,
  Coins,
  WifiOff,
  UserRound,
  ScanLine,
  Bell,
  History,
  Languages,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import {
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
  spring,
} from 'remotion'

import logo from '../../../../web/public/logo-with-text.svg'
import { Canvas } from '../../primitives'
import { i18n } from '../../video/local-i18n'
import expenseLimit from './assets/expense-limit.png'
import githubMark from './assets/github-mark.svg'
import splitwiseLogo from './assets/splitwise-logo.svg'
import { featureTiming } from './feature-timing'
import { roastFeatures } from './features'
import { expenses, importExpenses, money } from './fixture'
import {
  AppCrop,
  ExpenseEditor,
  FriendDemo,
  GroupDemo,
  SavedExpenses,
} from './presentation'
import {
  roastBeats as beats,
  roastTimeline,
  roastStoryboard as script,
} from './storyboard'

import './video.css'

const featureIcons = [
  PieChart,
  ArrowLeftRight,
  Coins,
  WifiOff,
  Repeat,
  ListChecks,
  Users,
  UserRound,
  FileSpreadsheet,
  Search,
  Wallet,
  ChartColumn,
  ScanLine,
  FileText,
  QrCode,
  Fingerprint,
  Bell,
  History,
  Languages,
  Server,
]
const features = roastFeatures.map((name, index) => ({
  name,
  icon: featureIcons[index],
}))
const avalancheFrom = beats.avalanche.from
const easeIn = (frame: number) =>
  interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
}
function Receipt({ index }: { index: number }) {
  const expense = expenses[index]
  return (
    <div className={`roast-receipt ${index === 4 ? 'receipt-blocked' : ''}`}>
      <span>EXPENSE 0{index + 1}</span>
      <strong>{expense.title}</strong>
      <div className="roast-paper-lines">
        <i />
        <i />
        <i />
      </div>
      <b>{money(expense.amount)}</b>
      <div className={index === 4 ? 'receipt-premium' : 'receipt-accepted'}>
        {index === 4 ? (
          <>
            <TriangleAlert size={18} /> EXPENSE #5 · PAYWALLED
          </>
        ) : (
          <>
            <Check size={19} /> ADDED
          </>
        )}
      </div>
    </div>
  )
}
function Hook({ frame }: { frame: number }) {
  const drop = spring({
    frame: frame - 55,
    fps: 30,
    config: { damping: 13, stiffness: 170 },
  })
  return (
    <section className="roast-hook">
      <Img src={splitwiseLogo} className="roast-splitwise-mark" />
      <span className="roast-kicker">THE FREE PLAN, APPARENTLY.</span>
      <h1>
        <span className="roast-four">4</span>
        <span>
          expenses.
          <br />A day.
        </span>
      </h1>
      <div className="roast-receipts">
        {expenses.map((expense, index) => (
          <div
            key={expense.title}
            style={{
              transform:
                index === 4
                  ? `translateY(${(1 - drop) * -650}px) rotate(${(1 - drop) * 18 - 3}deg)`
                  : `rotate(${[-4, 2, -2, 3][index]}deg)`,
            }}
          >
            <Receipt index={index} />
          </div>
        ))}
      </div>
      <div className="roast-arithmetic">
        Adding a fifth expense?
        <span className="roast-pro-tag">PREMIUM FEATURE.</span>
      </div>
      <div className="roast-source">
        <span>STRAIGHT FROM SPLITWISE'S HELP CENTER</span>
        <Img src={expenseLimit} />
        <small>
          kb.splitwise.com/pro/what-is-splitwise-pro · captured 14 Oct 2026
        </small>
      </div>
    </section>
  )
}
function ImportEscape({ frame }: { frame: number }) {
  const travel = interpolate(frame, [25, 70], [0, 1], clamp)
  const unfold = interpolate(frame, [70, 110], [0, 1], clamp)
  return (
    <section className="roast-escape">
      <h1>
        Bring your whole group’s expenses.
        <br />
        <em>Leave the paywall bullshit behind.</em>
      </h1>
      <div className="escape-source">
        <Img src={splitwiseLogo} />
        <div className="escape-paper-stack">
          <Receipt index={0} />
          <Receipt index={3} />
        </div>
        <div className="escape-clutter">
          <span>WHAT'S NEXT?</span>
          <Pizza size={52} />
          <strong>CrustCoin.</strong>
          <small>Finance your leftovers.</small>
        </div>
      </div>
      <div className="escape-destination">
        <Img src={logo} />
        <div className="escape-count" style={{ opacity: unfold }}>
          Your whole group. All its expenses.
        </div>
        <div className="escape-expenses">
          {importExpenses.map((expense, index) => (
            <div
              key={expense.title}
              style={{
                opacity: interpolate(
                  frame,
                  [75 + index * 1.3, 90 + index * 1.3],
                  [0, 1],
                  clamp,
                ),
                transform: `translateY(${(1 - unfold) * (100 + index * 8)}px)`,
              }}
            >
              <FileText size={18} />
              <span>{expense.title}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        className="escape-file"
        style={{
          left: 460 + travel * 710,
          top: 440 - Math.sin(travel * Math.PI) * 90,
          opacity: 1 - unfold,
          transform: `rotate(${-8 + travel * 12}deg) scale(${1 - unfold * 0.35})`,
        }}
      >
        <FileSpreadsheet size={90} />
        <strong>Barcelona trip.csv</strong>
        <span>Group expense history</span>
      </div>
    </section>
  )
}
function Takeover({ frame }: { frame: number }) {
  const start = beats.parody.from - 60
  const progress = interpolate(
    frame,
    [start + 10, beats.parody.from + 15],
    [0, 1],
    clamp,
  )
  const visible = frame >= start
  const fill = interpolate(
    frame,
    [start, start + 20, beats.parody.from - 1],
    [0, 1.5, 22],
    clamp,
  )
  const coinX = interpolate(progress, [0, 1], [1680, 520])
  const coinY = interpolate(progress, [0, 1], [570, 440])
  return visible ? (
    <div className="takeover-stage">
      <div className="takeover-fill" style={{ transform: `scale(${fill})` }} />
      <div
        className="takeover-label"
        style={{
          left: interpolate(progress, [0, 1], [1590, 90]),
          top: interpolate(progress, [0, 1], [600, 75]),
        }}
      >
        WHAT'S NEXT?
      </div>
      <div
        className="takeover-pizza"
        style={{
          left: coinX,
          top: coinY,
          transform: `translate(-50%, -50%) scale(${0.22 + progress * 0.78}) rotate(${Math.sin((frame - start) / 13) * 5 * progress}deg)`,
        }}
      >
        <Pizza size={230} strokeWidth={1.5} />
        <span>CC</span>
      </div>
      <div
        className="takeover-copy"
        style={{
          left: interpolate(progress, [0, 1], [1490, 900]),
          top: interpolate(progress, [0, 1], [640, 310]),
          transform: `scale(${0.28 + progress * 0.72})`,
          opacity: interpolate(frame, [start, start + 8], [0, 1], clamp),
        }}
      >
        <span style={{ opacity: progress }}>YOU BOUGHT PIZZA.</span>
        <h1>CrustCoin.</h1>
        <p>
          Finance your
          <br />
          leftovers.
        </p>
      </div>
      {frame >= beats.parody.from && (
        <>
          <svg
            className="roast-ad-chart"
            viewBox="0 0 900 230"
            aria-hidden="true"
          >
            <path
              d="M0 220 L120 160 L220 180 L360 75 L470 110 L620 30 L720 70 L890 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              strokeLinejoin="round"
            />
          </svg>
          <div className="roast-circus">
            WELCOME TO THE MONETIZATION CIRCUS.
          </div>
        </>
      )}
    </div>
  ) : null
}
function Parody() {
  return <section className="roast-parody" />
}
function Reveal() {
  return (
    <section className="roast-reveal">
      <Img src={logo} />
      <h1>
        Finally,
        <br />
        just split
        <br />
        <em>the damn bill.</em>
      </h1>
      <div className="roast-reveal-aside">
        An expense splitter. Imagine that.
      </div>
    </section>
  )
}
function Demo({
  number,
  heading,
  children,
  badge,
}: {
  number: string
  heading: string
  children: ReactNode
  badge?: string
}) {
  return (
    <section className="roast-demo">
      <div className="roast-demo-top">
        <div className="roast-section-number">{number}</div>
        <h1>{heading}</h1>
        <Img src={logo} />
      </div>
      <AppCrop>{children}</AppCrop>
      {badge && (
        <div className="roast-proof-badge">
          <Check size={24} />
          {badge}
        </div>
      )}
    </section>
  )
}
function Avalanche({ frame }: { frame: number }) {
  const spokenFrame = Math.max(0, frame - script.leadFrames)
  const active = Math.max(
    0,
    featureTiming.findIndex((segment) => spokenFrame < segment.endFrame),
  )
  const segment = featureTiming[active]
  const offset = interpolate(
    spokenFrame,
    [segment.startFrame, segment.endFrame],
    [Math.max(0, active - 2) * 130, Math.max(0, active - 1) * 130],
    clamp,
  )
  return (
    <section className="roast-avalanche">
      <div className="roast-avalanche-heading">ALSO INCLUDED.</div>
      <div className="roast-feature-viewport">
        <div
          className="roast-feature-list"
          style={{ transform: `translateY(${-offset}px)` }}
        >
          {features.map(({ name, icon: Icon }, index) => (
            <div
              key={`${name}-${index}`}
              className={index === active ? 'feature-speaking' : ''}
            >
              <Icon size={48} />
              <span>{name}</span>
              <Check size={48} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
function Stop({ frame }: { frame: number }) {
  return (
    <section className="roast-stop">
      <span>TOO MANY FEATURES. TOO LITTLE VIDEO.</span>
      <h1>
        We're not
        <br />
        reading all that.
      </h1>
      <div style={{ opacity: easeIn(frame - 43) }}>
        And you're <em>not paying</em> for it.
      </div>
    </section>
  )
}
function Finish({ frame }: { frame: number }) {
  return (
    <section className="roast-finish">
      <Img src={logo} />
      <div className="roast-ownership">
        <span style={{ opacity: easeIn(frame - 3) }}>
          <Check size={32} />
          Free
        </span>
        <span style={{ opacity: easeIn(frame - 25) }}>
          <Img src={githubMark} />
          Open source
        </span>
        <span style={{ opacity: easeIn(frame - 58) }}>
          <GitFork size={32} />
          Yours to fork
        </span>
        <span style={{ opacity: easeIn(frame - 100) }}>
          <Server size={32} />
          Self-hostable
        </span>
      </div>
      <h1 style={{ opacity: easeIn(frame - 136) }}>
        Your bills are
        <br />
        expensive enough.
      </h1>
      <div className="roast-cta" style={{ opacity: easeIn(frame - 195) }}>
        <span>Ditch the paywall.</span>
        <strong>
          spl
          <span
            className="roast-domain-ii"
            style={{
              backgroundColor:
                frame >= 285 && frame < 320 ? '#afe6bc' : 'transparent',
            }}
          >
            ii
          </span>
          t.cloud
          <ArrowUpRight size={110} />
        </strong>
        <small>Free public instance</small>
      </div>
    </section>
  )
}

export function SplitwisePaywallRoast({
  audioEnabled = true,
  soundDesignEnabled = true,
}: {
  audioEnabled?: boolean
  soundDesignEnabled?: boolean
}) {
  const frame = useCurrentFrame()
  let content: ReactNode
  if (frame < beats.parody.from) content = <Hook frame={frame} />
  else if (frame < beats.reveal.from) content = <Parody />
  else if (frame < beats.expenses.from) content = <Reveal />
  else if (frame < beats.groups.from) {
    const local = frame - beats.expenses.from
    content = (
      <Demo
        number="01"
        heading="Five expenses. Civilization survived."
        badge={local >= 86 ? 'Added. No daily cap.' : undefined}
      >
        {local >= 86 ? (
          <SavedExpenses />
        ) : (
          <ExpenseEditor pressed={local >= 80} />
        )}
      </Demo>
    )
  } else if (frame < beats.friends.from)
    content = (
      <Demo
        number="02"
        heading="Whole group. Zero paywall drama."
        badge="Know who owes what."
      >
        <GroupDemo balance={frame - beats.groups.from >= 65} />
      </Demo>
    )
  else if (frame < beats.import.from)
    content = (
      <Demo
        number="03"
        heading="Two friends. One bill. Zero paywall bullshit."
        badge={
          frame - beats.friends.from >= 78 ? 'Alex is owed $12.00.' : undefined
        }
      >
        <FriendDemo saved={frame - beats.friends.from >= 78} />
      </Demo>
    )
  else if (frame < avalancheFrom) {
    const local = frame - beats.import.from
    content = <ImportEscape frame={local} />
  } else if (frame < beats.stop.from)
    content = <Avalanche frame={frame - avalancheFrom} />
  else if (frame < beats.finish.from)
    content = <Stop frame={frame - beats.stop.from} />
  else content = <Finish frame={frame - beats.finish.from} />
  return (
    <I18nextProvider i18n={i18n}>
      <Canvas width={1920} height={1080} className="paywall-roast">
        {content}
        {frame < beats.reveal.from && <Takeover frame={frame} />}
        {audioEnabled && soundDesignEnabled && (
          <Audio
            src={staticFile('sound-design/splitwise-paywall-roast/mix.wav')}
          />
        )}
        {audioEnabled &&
          !soundDesignEnabled &&
          roastTimeline.map((beat) => (
            <Sequence
              key={beat.id}
              from={beat.from + script.leadFrames}
              durationInFrames={
                beat.durationInFrames -
                script.leadFrames -
                (beat.resultHoldFrames ?? script.resultHoldFrames)
              }
            >
              <Audio
                src={staticFile(
                  `narration/splitwise-paywall-roast/${beat.id}.wav`,
                )}
              />
            </Sequence>
          ))}
      </Canvas>
    </I18nextProvider>
  )
}
