# Animated promos

## Story and motion

Use Remotion in `apps/promo` for scripted, truthful feature walkthroughs. Keep the existing still renderer available when a PNG composition is the better deliverable. This toolkit exports local videos and can generate narration with local Kokoro inference. It does not capture the running app or publish content.

Turn the confirmed brief into a timed storyboard: what appears, what action occurs, what changes, and how long the viewer has to read the result. Duration follows the story and measured narration, rather than a fixed promotional time limit. Use one scenario across scenes, build all text and UI in code, and keep amounts and allocations derived from shared fixtures. Show the actual action that unlocks a capability, including any confirmation required by the app. On-screen narration must distinguish AI extraction from user choices.

Reuse `Canvas`, `BrandHeader`, `UiFrame`, semantic theme tokens, local fonts, and only the necessary web presentation components. Shared SVG imports work in both bundlers without Vite's `?url` suffix. Add imported web component paths to the stylesheet's Tailwind sources. Keep feature-specific presentation in the campaign, independent of API/DB/router providers.

### Attention and pacing

For every beat, specify what the viewer should notice, the action frame, the visible result, essential reading, and narration. Keep one primary attention target. Use a large centered UI stage with a short heading above it; place small annotations adjacent to their targets. Narration explains the meaning while short labels keep the story understandable muted. Avoid reading a paragraph on one side while detailed actions run elsewhere. Do not duplicate whole spoken paragraphs on screen or highlight unrelated elements at once.

Use **orient → act → hold**. Start with about one second to locate a control, highlight it, show a brief pressed state at the action frame, then hold the result for at least two seconds. Increase holds for item lists, amounts, participant changes, and unfamiliar screens. As an initial reading budget, allow `essential words / 3 + 1 second`; validate at delivery size rather than treating the formula as a guarantee. Narrated beats must fit actual measured speech, a short lead, and a result hold. The original receipt sample uses a 0.4-second lead; its AI variant uses a 0.6-second lead. Both reserve at least two seconds after measured speech. Shorten copy or extend beats when narration exceeds the budget; never increase speech speed just to fit a preset length.

Derive video scenes, individual audio sequences, and the mixed soundtrack from the selected narration script’s timeline. Never place a variant’s clips on another variant’s schedule. Use separate narrated beats for distinct technical stages so each label stays visible for its own speech and reading hold. For instructed actions, set `actionOffsetFrames` within the beat; export preflight requires narration to end at least half a second before that action. Verify the actual mix has the expected clips at their scene offsets and narration-free reading holds; validating clip lengths alone does not prove correct placement. Run `test:export` after changing audio assembly.

**Do not use simulated cursors or travelling click dots.** Use `Highlight` around the actual target and `ActionCue` to show its pressed state, followed by a truthful state change. Element morphs may connect related before/after states if identity and behavior stay clear; avoid decorative morphs between unrelated controls. Keep applied state separate from modal draft state until the real save action. Keep stable UI mounted across related beats and avoid animating headings or whole screens while the viewer is reading an important control.

Drive every animated property and illustrated UI state from `useCurrentFrame()`, `useVideoConfig()`, and frame interpolation or springs. Use `Entrance`, `Reveal`, `Focus`, `Highlight`, and `ActionCue` from `src/video/motion.tsx`. Nested sequences use local frames. The canvas disables CSS transitions and animations intentionally; change inline properties from the current frame instead.

Do not use timers, wall-clock time, unseeded randomness, or autonomous Motion/CSS playback to animate export scenes. If another library provides a needed effect, it must support deterministic seeking to a frame; Remotion's built-in motion is enough for ordinary reveals, highlights, and zooms. See [Remotion animation guidance](https://www.remotion.dev/docs/animating-properties).

If an action takes longer in the real app than in the story, use truthful pacing or an agreed label such as “Demo sped up.” Compressed playback is not evidence of an actual latency claim.

## Local narration

Use the pinned `kokoro-onnx` Python helper in `apps/promo/scripts/tts`, invoked through Bun. `uv.lock` fixes the runtime dependencies; the ONNX model and voices are downloaded separately and checked against pinned SHA-256 hashes. Model files, the isolated interpreter, caches, generated WAVs, and exports are ignored. Setup needs `uv`, `curl`, and network access; generation uses the prepared interpreter and model files directly, disables ONNX Runtime telemetry, and does not start a server or use a cloud TTS service. FFprobe measures clip durations. Dependencies must not download at render time.

```sh
bun --filter @spliit/promo narration:setup
bun --filter @spliit/promo narration --campaign receipt-scan-v2-7-0 --variant walkthrough
```

Use `--force` to regenerate a current cache. The preferred receipt voice is **`af_nicole`**, at natural speed `1.0`. Changing a voice is a brief decision; do not substitute another voice silently. Register plain-data scripts in `src/video/narration-scripts.ts` and reference their ID in video variant metadata with `narration`. Keep each beat’s text, minimum duration, lead, and result hold together; use the same timeline for scene/action authoring and audio sequences. The receipt example is `src/campaigns/receipt-storyboard.ts`. Text, voice, engine, or speed changes invalidate the cached speech; timing-only edits reuse it.

The manifest records spoken text, voice/settings, model hashes, clip hashes, and measured durations. Export preflight rejects missing, stale, modified, or overlong narration. Audio is generated before rendering and loaded through Remotion `staticFile()` from `output/media/narration/<script-id>/`. Never call TTS from a component or infer duration from word count alone. Listen to the clips and the final mix for missing words, pronunciation, distracting pauses, quiet speech, clipping, and alignment with UI changes. Clearly pronounce currency amounts; keep the dollar allocations factual. If narration is too quiet, normalize without clipping and record that processing in the cache identity.

See [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) and [Kokoro’s model/voice documentation](https://huggingface.co/hexgrad/Kokoro-82M). Keep voice/model licenses with their source references; no account setup or purchases are part of this workflow.

## Local music and effects

After pacing and narration are settled, optionally add a restrained sound pass. Use **Stable Audio 3 Small-Music** for a warm instrumental bed, **Small-SFX** for a soft transition texture, and **procedural synthesis** for precise selection taps and a completion chime. Keep the existing scene/action frames; never accelerate the video to match music. Prefer no vocals, sparse instrumentation, no dramatic builds, and few cues. Generated effects are editorial additions, not claims that the application makes those sounds.

The prepared runtime uses the official [Stable Audio 3 Apple Silicon MLX implementation](https://github.com/Stability-AI/stable-audio-3/tree/main/optimized/mlx), pinned to a source revision with locked Python dependencies and SHA-256 checked model downloads. It is separate from Kokoro. On other hardware, use an officially supported CPU runtime rather than silently substituting a cloud service or model. Model weights use the [Stability AI Community License](https://stability.ai/license); verify applicable terms before commercial delivery. Do not create accounts, register, or purchase anything automatically. Do not bypass gated model access; report any access prerequisite.

```sh
bun --filter @spliit/promo sound-design:setup
bun --filter @spliit/promo sound-design --campaign receipt-scan-v2-7-0 --variant walkthrough
bun --filter @spliit/promo render:video --campaign receipt-scan-v2-7-0 --variant walkthrough
```

Setup downloads the local runtime and weights once. Generation then runs offline without starting a server. `sound-design --force` regenerates the selected assets; preserve approved assets until replacements are inspected. The receipt recipe lives in `src/campaigns/receipt-sound-design.ts`: prompts, seeds, duration, mix levels, and cues tied to the existing visual timeline. Cache generated music, effects, background-only audio, and the final narration/music/effects mix under ignored `output/media/sound-design/<id>/`. Keep recipes and procedural synthesis code tracked, not model weights or exports. The manifest records runtime/model versions, prompts, seeds, processing, asset hashes, and a fingerprint covering the narration, timeline, and mixer. Export preflight rejects absent, stale, or modified audio instead of silently omitting it.

The receipt mix resamples speech without changing its speed, fades music in/out, reduces it around measured narration windows with smooth attack/release, and places sparse cues at actual action frames. Keep the bed clearly below Nicole and limit peaks with headroom. Levels are starting points, not a substitute for listening. Audition generated music/effects independently and listen to the complete mix through speakers and headphones: reject vocals, harsh transients, distracting melodies, unwanted pauses, abrupt cuts, or masked words. Inspect an audio waveform/spectrum and peak/loudness measurements as supporting checks; do not claim that numerical checks alone prove pleasant sound. If listening tools are unavailable, disclose that limitation.

Use `render:video ... --no-sound-design` for narration only, or `--silent` for no audio. Poster exports require no sound files. These flags must not change visual timing. For approved sound-designed variants, the final local WAV replaces the separate narration clips during export so speech is not doubled. Validate the mix duration against the composition, stale-cache rejection, successful decoding, AAC output, audible speech, and silence-free gaps where music should continue. Deliver the finished MP4/poster/source; offer the mix WAV when useful.

## Register and export

Add a `kind: 'video'` variant to `src/catalog.ts` with width, height, fps, durationInFrames, compositionId, and posterFrame (zero-based), plus the optional narration script ID. IDs must be unique, lowercase hyphenated identifiers. Dimensions must be positive even integers for H.264. Register its component by compositionId in `src/video/registry.tsx`; the Remotion entrypoint registers compositions from the catalog and waits for local fonts and images.

Static variants use `kind: 'static'` and retain the existing dimensions/registry. Renderers select only their own variant kind and reject a mismatched explicit selection.

```sh
bun --filter @spliit/promo render:video --campaign receipt-scan-v2-7-0 --variant walkthrough
bun --filter @spliit/promo render:poster --campaign receipt-scan-v2-7-0 --variant walkthrough
bun --filter @spliit/promo render:poster --campaign receipt-scan-v2-7-0 --variant walkthrough --frame <zero-based frame>
```

Omit `--variant` to export all video variants. `--out <directory>` resolves from the command's working directory (`apps/promo` with Bun's filter). The default ignored output directory is `apps/promo/output/`. Outputs are `<campaign>-<variant>.mp4` and `<campaign>-<variant>-poster.png`; changing the selected poster frame replaces that poster.

Exports bundle automatically using the same aliases/Tailwind configuration as Studio, render H.264 MP4 at the catalog resolution/fps with `yuv420p`, adding AAC audio for narrated or sound-designed variants, and write the PNG poster at full resolution. Use `render:video ... --no-sound-design` for narration only. Use `render:video ... --silent` to export without audio; this requires no generated speech. Posters also require no audio. Narrated variants fail rather than silently exporting muted when speech is missing. Temporary bundles and incomplete outputs are cleaned up; final files are moved into place after successful rendering. Remotion downloads its headless browser on first use if needed. The existing `browser:install` command installs Playwright's browser for static exports, not Remotion's browser.

Start `bun --filter @spliit/promo studio` only when a live preview is requested. It uses the same compositions and configuration; a custom editor is unnecessary for this export-oriented workflow. Use Bun for package management and scripts. Keep all Remotion packages pinned to the same version. Remotion's [license terms](https://www.remotion.dev/license) apply; this workflow does not purchase licenses or set up accounts.

## Inspect and deliver

Watch the exported MP4 and inspect opening/final frames, scene midpoints, action frames, and transitions. Export additional poster frames or extract them with FFmpeg for visual inspection. Inspect at full size and approximately 800×450 for a landscape story. Check readable holds, legible text and item amounts, wrapping, child clipping, logo proportions, highlight targets and action/result alignment, no unexpected blank frames, and consistency with the actual app screens/actions.

Verify resolution, fps, duration, H.264 pixel format, successful decoding, and the expected audio mode using FFprobe/FFmpeg (AAC for narration; no audio track for `--silent`). Run scoped format/checks, affected tests, and `test:export` when changing the renderer or bundler. The export smoke test renders the full narrated sample, validates AAC and nonempty speech, rejects missing/stale narration, and checks silent output separately. It requires prepared narration, local Chromium, and FFmpeg/FFprobe, but no API or DB.

Deliver the MP4, PNG poster, and editable campaign source links. Keep source tracked and generated exports untracked. Creation does not authorize social posting, publishing, or starting app services.
