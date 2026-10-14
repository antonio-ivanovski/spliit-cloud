import {
  ArrowUpRight,
  Check,
  FileSpreadsheet,
  FileText,
  GitFork,
  Pizza,
  Server,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import {
  Audio,
  Img,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion'

import logo from '../../../../web/public/logo-with-text.svg'
import { Canvas } from '../../primitives'
import { i18n } from '../../video/local-i18n'
import expenseLimit from './assets/expense-limit.png'
import githubMark from './assets/github-mark.svg'
import splitwiseLogo from './assets/splitwise-logo.svg'
import { expenses, importExpenses, money } from './fixture'
import { ExpenseEditor, SavedExpenses } from './presentation'
import {
  roastShortsBeats as beats,
  roastShortsTimeline,
  roastShortsStoryboard as script,
} from './storyboard-shorts'

import './video-shorts.css'

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
}
const easeIn = (frame: number) =>
  interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

function Receipt({ index }: { index: number }) {
  const expense = expenses[index]
  return (
    <div className={`shorts-receipt ${index === 4 ? 'receipt-blocked' : ''}`}>
      <span>EXPENSE 0{index + 1}</span>
      <strong>{expense.title}</strong>
      <div className="shorts-paper-lines">
        <i />
        <i />
        <i />
      </div>
      <b>{money(expense.amount)}</b>
      <div className={index === 4 ? 'receipt-premium' : 'receipt-accepted'}>
        {index === 4 ? (
          <>
            <TriangleAlert size={16} /> #5 · PAYWALLED
          </>
        ) : (
          <>
            <Check size={17} /> ADDED
          </>
        )}
      </div>
    </div>
  )
}

function Hook({ frame }: { frame: number }) {
  const drop = spring({
    frame: frame - 40,
    fps: 30,
    config: { damping: 13, stiffness: 170 },
  })
  return (
    <section className="shorts-hook">
      <Img src={splitwiseLogo} className="shorts-splitwise-mark" />
      <span className="shorts-kicker">THE FREE PLAN, APPARENTLY.</span>
      <h1>
        <span className="shorts-four">4</span>
        <span>
          expenses.
          <br />A day.
        </span>
      </h1>
      <div className="shorts-receipts">
        {expenses.map((expense, index) => (
          <div
            key={expense.title}
            style={{
              transform:
                index === 4
                  ? `translateY(${(1 - drop) * -520}px) rotate(${(1 - drop) * 18 - 3}deg)`
                  : `rotate(${[-4, 2, -2, 3][index]}deg)`,
            }}
          >
            <Receipt index={index} />
          </div>
        ))}
      </div>
      <div className="shorts-arithmetic">
        Adding a fifth expense?
        <span className="shorts-pro-tag">PREMIUM FEATURE.</span>
      </div>
      <div className="shorts-source">
        <span>STRAIGHT FROM SPLITWISE'S HELP CENTER</span>
        <Img src={expenseLimit} />
        <small>kb.splitwise.com/pro/what-is-splitwise-pro</small>
      </div>
    </section>
  )
}

function Parody() {
  const frame = useCurrentFrame()
  const pop = spring({
    frame,
    fps: 30,
    config: { damping: 12, stiffness: 160 },
  })
  return (
    <section className="shorts-parody">
      <span className="shorts-parody-kicker">YOU BOUGHT PIZZA.</span>
      <div
        className="shorts-coin"
        style={{ transform: `scale(${0.6 + pop * 0.4})` }}
      >
        <Pizza size={150} strokeWidth={1.5} />
        <span>CC</span>
      </div>
      <h1>CrustCoin.</h1>
      <p>
        Finance your
        <br />
        leftovers.
      </p>
      <div className="shorts-circus">WELCOME TO THE MONETIZATION CIRCUS.</div>
    </section>
  )
}

function Reveal() {
  return (
    <section className="shorts-reveal">
      <Img src={logo} />
      <h1>
        Finally,
        <br />
        just split
        <br />
        <em>the damn bill.</em>
      </h1>
      <div className="shorts-reveal-aside">
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
    <section className="shorts-demo">
      <div className="shorts-demo-top">
        <div className="shorts-section-number">{number}</div>
        <h1>{heading}</h1>
      </div>
      <div className="shorts-app-crop">
        <div className="shorts-app-content">{children}</div>
      </div>
      {badge && (
        <div className="shorts-proof-badge">
          <Check size={22} />
          {badge}
        </div>
      )}
    </section>
  )
}

function ImportEscape({ frame }: { frame: number }) {
  const travel = interpolate(frame, [10, 42], [0, 1], clamp)
  const unfold = interpolate(frame, [42, 68], [0, 1], clamp)
  const shown = importExpenses.slice(0, 10)
  return (
    <section className="shorts-escape">
      <h1>
        Bring your whole group’s expenses.
        <br />
        <em>Leave the paywall bullshit behind.</em>
      </h1>
      <div className="shorts-escape-source">
        <Img src={splitwiseLogo} />
        <div className="shorts-paper-stack">
          <Receipt index={0} />
          <Receipt index={1} />
          <Receipt index={3} />
        </div>
      </div>
      <div className="shorts-escape-destination">
        <Img src={logo} />
        <div className="shorts-escape-count" style={{ opacity: unfold }}>
          Your whole group. All its expenses.
        </div>
        <div className="shorts-escape-expenses">
          {shown.map((expense, index) => (
            <div
              key={expense.title}
              style={{
                opacity: interpolate(
                  frame,
                  [48 + index * 2, 60 + index * 2],
                  [0, 1],
                  clamp,
                ),
                transform: `translateY(${(1 - unfold) * (60 + index * 6)}px)`,
              }}
            >
              <FileText size={16} />
              <span>{expense.title}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        className="shorts-escape-file"
        style={{
          top: 560 + travel * 480,
          opacity: 1 - unfold,
          transform: `translateX(-50%) rotate(${-8 + travel * 12}deg) scale(${1 - unfold * 0.35})`,
        }}
      >
        <FileSpreadsheet size={64} />
        <strong>Barcelona trip.csv</strong>
        <span>Group expense history</span>
      </div>
    </section>
  )
}

function Finish({ frame }: { frame: number }) {
  return (
    <section className="shorts-finish">
      <Img src={logo} className="shorts-finish-logo" />
      <div className="shorts-ownership">
        <span style={{ opacity: easeIn(frame - 2) }}>
          <Check size={28} />
          Free
        </span>
        <span style={{ opacity: easeIn(frame - 12) }}>
          <Img src={githubMark} />
          Open source
        </span>
        <span style={{ opacity: easeIn(frame - 24) }}>
          <GitFork size={28} />
          Yours to fork
        </span>
        <span style={{ opacity: easeIn(frame - 36) }}>
          <Server size={28} />
          Self-hostable
        </span>
      </div>
      <h1 style={{ opacity: easeIn(frame - 55) }}>
        Your bills are
        <br />
        expensive enough.
      </h1>
      <div className="shorts-cta" style={{ opacity: easeIn(frame - 85) }}>
        <span>Ditch the paywall.</span>
        <strong>
          spliit.cloud
          <ArrowUpRight size={72} />
        </strong>
        <small>Free public instance</small>
      </div>
    </section>
  )
}

export function SplitwisePaywallRoastShorts({
  audioEnabled = true,
  soundDesignEnabled = true,
}: {
  audioEnabled?: boolean
  soundDesignEnabled?: boolean
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  void fps
  let content: ReactNode
  if (frame < beats.parody.from) content = <Hook frame={frame} />
  else if (frame < beats.reveal.from) content = <Parody />
  else if (frame < beats.expenses.from) content = <Reveal />
  else if (frame < beats.import.from) {
    const local = frame - beats.expenses.from
    content = (
      <Demo
        number="01"
        heading="Five expenses. Civilization survived."
        badge={local >= 72 ? 'Added. No daily cap.' : undefined}
      >
        {local >= 72 ? (
          <div className="shorts-saved-zoom">
            <SavedExpenses />
          </div>
        ) : (
          <ExpenseEditor pressed={local >= 65} />
        )}
      </Demo>
    )
  } else if (frame < beats.finish.from) {
    const local = frame - beats.import.from
    content = <ImportEscape frame={local} />
  } else content = <Finish frame={frame - beats.finish.from} />
  return (
    <I18nextProvider i18n={i18n}>
      <Canvas width={1080} height={1920} className="paywall-roast-shorts">
        {content}
        {audioEnabled && soundDesignEnabled && (
          <Audio
            src={staticFile(
              'sound-design/splitwise-paywall-roast-shorts/mix.wav',
            )}
          />
        )}
        {audioEnabled &&
          !soundDesignEnabled &&
          roastShortsTimeline.map((beat) => (
            <Sequence
              key={beat.id}
              from={beat.from + script.leadFrames}
              durationInFrames={
                beat.durationInFrames -
                script.leadFrames -
                ((beat as { resultHoldFrames?: number }).resultHoldFrames ??
                  script.resultHoldFrames)
              }
            >
              <Audio
                src={staticFile(
                  `narration/splitwise-paywall-roast-shorts/${beat.id}.wav`,
                )}
              />
            </Sequence>
          ))}
      </Canvas>
    </I18nextProvider>
  )
}
