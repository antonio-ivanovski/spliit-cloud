import '@fontsource-variable/nunito/wght.css'
import '../styles.css'
import { useEffect, useState } from 'react'
import {
  Composition,
  continueRender,
  delayRender,
  cancelRender,
  registerRoot,
} from 'remotion'

import { campaigns } from '../catalog'
import { videoCompositions } from './registry'

function ReadyComposition({
  compositionId,
  audioEnabled,
  soundDesignEnabled,
}: {
  compositionId: string
  audioEnabled: boolean
  soundDesignEnabled: boolean
}) {
  const Component = videoCompositions[compositionId]
  if (!Component) throw new Error(`Missing video composition: ${compositionId}`)
  const [handle] = useState(() =>
    delayRender('Loading local promo fonts and images'),
  )
  const [assetsReady, setAssetsReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      document.fonts.ready,
      ...Array.from(document.images, (image) => image.decode()),
    ])
      .then(() => {
        if (!cancelled) setAssetsReady(true)
      })
      .catch((error: unknown) => {
        if (!cancelled)
          cancelRender(
            error instanceof Error ? error : new Error(String(error)),
          )
      })
    return () => {
      cancelled = true
      continueRender(handle)
    }
  }, [handle])
  useEffect(() => {
    if (assetsReady) continueRender(handle)
  }, [assetsReady, handle])
  // Both standalone posters and video frames use settled local font metrics.
  return (
    <Component
      key={assetsReady ? 'loaded' : 'loading'}
      audioEnabled={audioEnabled}
      soundDesignEnabled={soundDesignEnabled}
    />
  )
}

function VideoRoot() {
  return (
    <>
      {campaigns.flatMap((campaign) =>
        Object.values(campaign.variants)
          .filter((variant) => variant.kind === 'video')
          .map((variant) => {
            const component = videoCompositions[variant.compositionId]
            if (!component)
              throw new Error(
                `Missing video composition: ${variant.compositionId}`,
              )
            return (
              <Composition
                key={variant.compositionId}
                id={variant.compositionId}
                component={ReadyComposition}
                defaultProps={{
                  compositionId: variant.compositionId,
                  audioEnabled: Boolean(variant.narration),
                  soundDesignEnabled: Boolean(variant.soundDesign),
                }}
                width={variant.width}
                height={variant.height}
                fps={variant.fps}
                durationInFrames={variant.durationInFrames}
              />
            )
          }),
      )}
    </>
  )
}

registerRoot(VideoRoot)
