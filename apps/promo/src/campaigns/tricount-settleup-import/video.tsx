import {
  ArrowDown,
  ArrowUpRight,
  Check,
  GitFork,
  Megaphone,
  Server,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import {
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion'

import logo from '../../../../web/public/logo-with-text.svg'
import { Canvas } from '../../primitives'
import { i18n } from '../../video/local-i18n'
import githubMark from '../splitwise-paywall-roast/assets/github-mark.svg'
import splitwiseLogo from '../splitwise-paywall-roast/assets/splitwise-logo.svg'
import settleupLogo from './assets/settleup-logo.png'
import tricountLogo from './assets/tricount-oneline.svg'
import {
  newImportersBeats as beats,
  newImportersStoryboard as script,
  newImportersTimeline,
} from './storyboard'

import './video.css'

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
}
const easeIn = (frame: number) => interpolate(frame, [0, 10], [0, 1], clamp)

function Kicker({ children }: { children: ReactNode }) {
  return <span className="escape-kicker">{children}</span>
}
function Heading({ children }: { children: ReactNode }) {
  return <h1 className="escape-heading">{children}</h1>
}

/** Beat 1 — staged question: Tricount? Or Settle Up? Move out. */
function Hook({ frame }: { frame: number }) {
  return (
    <section className="escape-hook">
      <Kicker>Two apps. One exit.</Kicker>
      <div className="escape-logos">
        <div
          className="escape-logo-card"
          style={{ opacity: easeIn(frame - 5) }}
        >
          <Img src={tricountLogo} className="escape-tricount-mark" />
        </div>
        <div
          className="escape-logo-card"
          style={{ opacity: easeIn(frame - 70) }}
        >
          <Img src={settleupLogo} className="escape-settleup-mark" />
        </div>
      </div>
      <div style={{ opacity: easeIn(frame - 105) }}>
        <Heading>
          Time to <em>move out.</em>
        </Heading>
      </div>
      <div className="escape-hook-sub" style={{ opacity: easeIn(frame - 150) }}>
        Free. Open source. Just better.
      </div>
    </section>
  )
}

/** Beat 2 — both stabs on one screen. */
function Roast({ frame }: { frame: number }) {
  return (
    <section className="escape-roast">
      <Kicker>Why leave?</Kicker>
      <div className="escape-roast-cols">
        <div className="escape-roast-col">
          <Img src={tricountLogo} className="escape-roast-mark" />
          <p
            className="escape-roast-line"
            style={{ opacity: easeIn(frame - 5) }}
          >
            The export button is gone.
          </p>
          <div
            className="escape-support-ticket"
            style={{ opacity: easeIn(frame - 110) }}
          >
            <span>To: support@…</span>
            <strong>“Can I please have my expenses?”</strong>
          </div>
          <p
            className="escape-roast-line"
            style={{ opacity: easeIn(frame - 160) }}
          >
            Email support. Ask nicely. <em>Then wait.</em>
          </p>
        </div>
        <div className="escape-roast-col">
          <Img src={settleupLogo} className="escape-roast-mark" />
          <p
            className="escape-roast-line"
            style={{ opacity: easeIn(frame - 210) }}
          >
            Free export. Fair.
          </p>
          <div
            className="escape-ad-card"
            style={{ opacity: easeIn(frame - 260) }}
          >
            <Megaphone size={28} />
            <strong>Ad break</strong>
            <span>After expense 3 of 3. Enjoy.</span>
          </div>
          <p
            className="escape-roast-line"
            style={{ opacity: easeIn(frame - 320) }}
          >
            Ads every third expense? Paywalled receipt photos?{' '}
            <em>Not fair.</em>
          </p>
        </div>
      </div>
    </section>
  )
}

/** Beat 3 — explicit import promise: chips funnel into the Cloud lockup. */
function Escape({ frame }: { frame: number }) {
  return (
    <section className="escape-demo">
      <Kicker>Spliit Cloud now imports both.</Kicker>
      <Heading>Two ways in.</Heading>
      <div className="escape-funnel">
        <div className="escape-chip" style={{ opacity: easeIn(frame - 10) }}>
          <Img src={tricountLogo} className="escape-chip-mark" />
          <div>
            <strong>tricount.com/skitrip2026</strong>
            <span>Paste the link</span>
          </div>
        </div>
        <div className="escape-chip" style={{ opacity: easeIn(frame - 40) }}>
          <Img src={settleupLogo} className="escape-chip-mark" />
          <div>
            <strong>flatshare-history.csv</strong>
            <span>Drop the CSV</span>
          </div>
        </div>
      </div>
      <ArrowDown
        size={40}
        className="escape-funnel-arrow"
        style={{ opacity: easeIn(frame - 70) }}
      />
      <Img
        src={logo}
        className="escape-cloud-lockup"
        style={{ opacity: easeIn(frame - 90) } as never}
      />
      <div className="escape-hook-sub" style={{ opacity: easeIn(frame - 130) }}>
        Welcome home.
      </div>
    </section>
  )
}

/** Beat 4 — quick text-only nod: Splitwise was covered long ago. */
function Family({ frame }: { frame: number }) {
  return (
    <section className="escape-demo">
      <Img
        src={splitwiseLogo}
        className="escape-family-mark-top"
        style={{ opacity: easeIn(frame - 5) }}
      />
      <Heading>
        Splitwise? <em>Covered long ago.</em>
      </Heading>
      <div className="escape-hook-sub" style={{ opacity: easeIn(frame - 40) }}>
        You are covered.
      </div>
    </section>
  )
}

/** Beat 5 — roast outro verbatim. */
function Finish({ frame }: { frame: number }) {
  return (
    <section className="escape-finish">
      <Img src={logo} />
      <div className="escape-ownership">
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
      <div className="escape-cta" style={{ opacity: easeIn(frame - 195) }}>
        <span>Ditch the paywall.</span>
        <strong>
          spl
          <span
            className="escape-domain-ii"
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

export function TricountSettleUpImport({
  audioEnabled = true,
  soundDesignEnabled = true,
}: {
  audioEnabled?: boolean
  soundDesignEnabled?: boolean
}) {
  const frame = useCurrentFrame()
  let content: ReactNode
  if (frame < beats.roast.from) content = <Hook frame={frame} />
  else if (frame < beats.escape.from)
    content = <Roast frame={frame - beats.roast.from} />
  else if (frame < beats.family.from)
    content = <Escape frame={frame - beats.escape.from} />
  else if (frame < beats.finish.from)
    content = <Family frame={frame - beats.family.from} />
  else content = <Finish frame={frame - beats.finish.from} />
  return (
    <I18nextProvider i18n={i18n}>
      <Canvas width={1920} height={1080} className="import-escape">
        {content}
        {audioEnabled && soundDesignEnabled && (
          <Audio
            src={staticFile('sound-design/tricount-settleup-import/mix.wav')}
          />
        )}
        {audioEnabled &&
          !soundDesignEnabled &&
          newImportersTimeline.map((beat) => (
            <Sequence
              key={beat.id}
              from={beat.from + script.leadFrames}
              durationInFrames={
                beat.durationInFrames -
                script.leadFrames -
                script.resultHoldFrames
              }
            >
              <Audio
                src={staticFile(
                  `narration/tricount-settleup-import/${beat.id}.wav`,
                )}
              />
            </Sequence>
          ))}
      </Canvas>
    </I18nextProvider>
  )
}
