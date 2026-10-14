---
name: create-promo
description: Create or revise Spliit feature and release promo images and animated feature walkthroughs using React, Remotion, and the repository's PNG/MP4 renderers. Use for promotional artwork and video exports, not application UI changes or social publishing.
---

# Create Spliit promos

Use `apps/promo` for editable, code-built artwork. Reusable app components and semantic theme tokens stay in `apps/web`; promo imports them through the `@web/*` alias. Define custom composition primitives, panels, and illustrations in `apps/promo`. Use the real SVG logo and existing local fonts. Keep promo compositions independent of live application state, API, and database.

Use the existing Vite/Playwright renderer for still artwork and Remotion for scripted animated walkthroughs. Keep both in the same package; reuse presentation and fixtures rather than forcing a still into a video or rewriting existing PNG campaigns. For an animated deliverable, read [references/animated-promos.md](references/animated-promos.md) after the feature and medium are understood.

## Shared understanding before artwork

Interview the user relentlessly until you reach a shared understanding of the feature and the promo. Map this as a **design tree**: every decision branches into the decisions that hang off it. Be persistent about unresolved decisions, not repetitive about answers already given.

First ground the tree in the actual feature: read release notes, trace the relevant UI and underlying behavior, and establish what changed, what users can now do, the before/after experience, and important limits. Do not equate a list of release-note bullets with understanding the feature. Explain your understanding in plain language so the user can correct it before choosing headlines or illustrations.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled—the questions you can ask now without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question, give your recommended answer and its rationale, then wait for the user's answers before the next round. Use the available question tool; if its question limit cannot fit the frontier, present the complete numbered round together in a single text question.

Each round reshapes the tree. Settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier after the answers. A question whose answer depends on another question still open in this round belongs to a later round, not this one. Do not draft a headline or layout around an unresolved feature interpretation.

Finding **facts** is your job, never the user's. When a frontier question needs a fact from the environment, dispatch a read-only exploration sub-agent to find it when delegation is available; otherwise investigate it yourself. Do not ask the user for anything you could look up. A running exploration is an unsettled prerequisite: only downstream questions wait for its result; ask the rest of the frontier now. Bring back evidence and explain any uncertainty or conflict between the implementation and the intended message. The **decisions** are the user's—put each unresolved decision to them and wait.

Cover the feature's defining benefit and intended use case, audience, primary message, supporting claims, release positioning, medium (still, video, or both), output count and dimensions/aspect ratio, and composition direction. Then settle headline/supporting copy, the actual app states to illustrate, fixture scenario, and deliberate simplifications. Propose English, light styling, and 1600×900 landscape PNGs as defaults; do not silently assume them. For video, settle the storyboard, actual app actions and scene states, duration, motion direction, reading holds, audio, and poster frame. Choose silent or locally narrated video explicitly, then decide whether it needs background music and sparse sound effects. For approved local sound design, use Stable Audio 3 Small-Music for the music bed, Small-SFX for transition textures, and procedural synthesis for precise taps and chimes; follow the animated reference. Use 30fps and determine duration from the story, measured speech, and reading holds; do not impose a 15–30 second cap. For local narration, use Kokoro with the project’s preferred voice `af_nicole` unless the user chooses another voice. Use a supplied or already confirmed brief without repeating discovery. Preserve approximate performance wording and distinguish available capabilities from planned functionality. Prefer one clear story over an exhaustive feature list.

Offer the user the option to include where the feature lives or short steps to reach it. Verify navigation paths from the current app code, then ask whether to include a location caption, concise steps, or neither. For example, currency swap is accessible through group Tools → Swap currency or by changing the settlement currency in group settings. Keep navigation guidance outside illustrated app panels unless showing the actual navigation UI; include it only when the user chooses it.

The discovery session is done when the frontier is empty: every relevant branch visited, nothing left silently assumed. Present a concise shared brief describing the feature, benefit, copy, composition, and limits, and wait for the user to confirm that you have reached a shared understanding before authoring or rendering artwork. Earlier explicit decisions and an already confirmed complete brief count; do not reopen them or add another approval step to an agreed design. If later evidence invalidates the brief, reopen only the affected branches before continuing.

## Author

- For animated promos, make the UI the main stage and direct attention to one target at a time. Put a short scene heading above it and brief annotations beside the relevant control; avoid persistent explanatory paragraphs competing with the UI. Ban simulated cursors and travelling click dots. Use a restrained highlight, a brief pressed state, and the actual resulting UI change.
- Use the canvas, brand header, headline, UI frame, metric, connector, and footer primitives as appropriate. Compositions are flexible JSX, not a mandatory layout. Add feature-specific primitives when they have a real reuse case.
- Use the real logo as the primary brand mark. Do not scatter `spliit.cloud` text or repeat the brand/domain to fill whitespace or balance a layout. Include a URL only when explicitly requested or when it serves a deliberate destination/CTA; never inject one automatically through a header or footer. Empty space is acceptable.
- Reuse semantic colors and web presentation components. Import only the web components needed by the composition and add their files to the promo stylesheet’s Tailwind `@source` entries. If a web component needs a small reuse adjustment, preserve its production defaults, appearance, and functionality; keep promo-only behavior and framing in promo. Layout, typography, and wording may be simplified, but the illustrated behavior must match the actual app. Trace displayed states, controls, and actions to the relevant components and user flow. Do not invent controls, show unavailable behavior, or move an existing capability into a screen that does not support it. Do not import entire screens or their API/provider machinery.
- For receipt promos, the scan overview reviews extracted details and items; per-item participant splits are configured in the expense editor. Do not add participant/split badges or split-editing controls to that overview. Explain item-level splitting in surrounding copy or illustrate the real editor separately. Distinguish AI extraction from choices the user makes.
- Prefer synthetic, coherent fixtures and HTML/CSS/SVG illustrations. Store money as integer cents and derive displayed totals from the same fixture. Avoid private screenshots and live data unless the user supplies and requests them. Never add explanations or captions saying data is fictional, synthetic, illustrative, or demo data unless the user explicitly requests that disclosure. Keep fixture provenance in source comments or metadata; artwork should focus on the feature. This does not permit fabricated feature or performance claims.
- Use AI image generation for a particular element only when requested, necessary, or clearly beneficial. If needed, apply the available imagegen skill and keep the resulting asset with that campaign's source. Build text, logos, UI, and diagrams in code.
- Add the campaign's ID, variant names, and dimensions to `apps/promo/src/catalog.ts`, and static React compositions to `apps/promo/src/registry.tsx`; video compositions belong in `apps/promo/src/video/registry.tsx`. Store campaign code and local assets together under `src/campaigns`. IDs and variant names should be lowercase hyphenated identifiers safe for filenames.
- Budget each video action as orient → act → hold. Allow roughly one second to locate the target and at least two seconds to understand the result. Fit narration and essential reading within the beat; extend the scene or shorten the script instead of accelerating speech. Follow the detailed timing and attention rules in the animated reference.
- Design sound after narration and reading holds are settled. Preserve scene timing; keep speech prominent, duck music during narration, and cue only meaningful actions. Avoid adding a sound to every highlight or transition. Generate and cache local WAV assets before rendering; never run inference inside a composition.
- Bundle fonts and assets locally. The static renderer rejects external requests; animated compositions must also use bundled local assets; no API, DB, or remote font service should be needed.

## Export and inspect

For MP4 and video poster exports, follow [the animated workflow](references/animated-promos.md). The commands below export static variants.

```sh
bun --filter @spliit/promo build
bun --filter @spliit/promo render --campaign <id> --variant <name>
```

Omit `--variant` to export all static variants. `--out <directory>` overrides the output directory; relative paths resolve from the command's working directory (`apps/promo` with Bun's filter). Generated PNGs default to the ignored `apps/promo/output/` folder. Keep campaign source tracked and exports untracked. Source follows current shared styling; exact historical artwork is not archived automatically.

The renderer builds static HTML/CSS/JS, starts a temporary loopback server, waits for fonts and images, freezes animation, captures only the canvas, and closes its browser/server. If Chromium is missing, run `bun --filter @spliit/promo browser:install`. Start `bun --filter @spliit/promo preview` only when a live preview is requested; it uses the built compositions.

Inspect every exported image at full size and at approximately 800×450. Check hierarchy, line wrapping, clipped content inside panels, logo proportions, factual copy, and matching fixture amounts. Compare illustrated controls and states against the app source, including where the user actually configures each feature. Remove invented behavior, unnecessary brand/domain text, and unrequested fictional-data disclosures before delivery. If navigation guidance was chosen, verify its labels and steps against the current app. The canvas overflow check cannot detect every clipped child. Revise and render again as needed. Run scoped formatting, lint/type checks, and affected existing tests when reused web presentation changes.

Deliver clickable output links (PNG, or MP4 plus its PNG poster) and the campaign source link. Creation does not authorize posting or publishing.
