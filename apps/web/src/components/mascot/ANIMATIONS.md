# Mascot animations

Shared reaction vocabulary, Bill’s recipes, and how to add another character. Durations live in `DEFAULT_REACTION_DURATION` in [`mascot-context.tsx`](./mascot-context.tsx) — keep this file in sync with that map, not the other way around.

Reactions are semantic. Host, mutations, and speech never know which character is on screen. Artwork is a lookup: `preferences.mascot` → [`getMascotDefinition`](./mascot-registry.ts) → `definition.Character`.

Signed-in Bill does not chatter. Poses are visual only unless the user taps Bill on a no-action surface. Two exceptions:

- **First-run coach** (until they open the speed dial): after the welcome wave, Bill may say a one-line “tap me to add…” hint. A `+` badge on the host trigger pulses until that first open. The badge stays afterwards; the speech and pulse do not. See [`mascot-actions-discovery.ts`](./mascot-actions-discovery.ts).
- **Unsigned homepage**: after a long idle delay it may cycle a short landing line and a sparse ambient pose. See [`use-landing-mascot.ts`](./use-landing-mascot.ts).

The `+` badge is host chrome, not character artwork — every mascot gets it when the host has actions.

## Vocabulary

| Reaction      | When                                                                  | Duration   | Idle-guard          |
| ------------- | --------------------------------------------------------------------- | ---------- | ------------------- |
| `idle`        | Resting companion                                                     | —          | —                   |
| `thinking`    | Long-running work (receipt / voice)                                   | 20s safety | Idle _can_ clear it |
| `success`     | Create / update / import; homepage auth success                       | 2500ms     | Protected           |
| `celebrate`   | Reimbursement / settle                                                | 2800ms     | Protected           |
| `acknowledge` | Delete, archive, leave, remove member/subgroup                        | 1200ms     | Protected           |
| `welcome`     | Every login (and each authenticated host mount); also a mild tap pose | 2200ms     | Protected           |
| `failure`     | Mutation or capture error                                             | 2600ms     | Protected           |

Protected means `react('idle')` is ignored while the timer is running. Same set as `isExpressiveMascotReaction`.

## Bill

Artwork: [`characters/bill/bill-character.tsx`](./characters/bill/bill-character.tsx). Receipt body, split halves, SVG face overlays. Motion (`motion/react`) drives poses. Reduced motion skips loops and snaps to the end face/icon.

Paper is **always a solid receipt**, including in dark mode. Fills use opaque `--mascot-paper`, `--mascot-paper-mid`, and `--mascot-paper-edge` (warm cream, no mint wash, no alpha). Outline is `--mascot-stroke`; printed lines and FX use `--mascot-accent` and `--mascot-rule`. Ink is `--mascot-ink`. Do **not** paint Bill with `--primary` — in dark mode that token is a neon mint and turns the opaque sheet into a glow sticker. Dark theme keeps a slightly dimmer cream sheet with a muted sage outline.

### Idle bob

Infinite `y` (3.6s) and `rotate` (5.4s) on the root SVG, plus blink / glance on the face. **Do not** stop these targets when the document hides — flipping to `{ y: 0, rotate: 0 }` is what froze the landing loop under extension popups.

On `window` `focus`, `pageshow`, and `visibilitychange` → `visible`, [`mascot-resume.ts`](./mascot-resume.ts) bumps `resumeCycle`. Idle remounts the Motion node (`key={`idle-${resumeCycle}`}`, `data-mascot-cycle`) so a dead clock starts from rest.

### Welcome

Small hop plus a temporary stick arm (`data-mascot-arm="wave"`) painted **behind** the receipt so the shoulder joint is hidden. One round-capped stroke pivots at the shoulder for two waves, then tucks away (`opacity` 0) before idle remounts. Open oval eyes, closed smile. No bubble. Reduced motion shows the arm briefly without the flap. Waves whenever a signed-in account appears on the host (login, remount).

### Success (create / update)

Modest bounce (`y` −13 then −6) and a short scale pulse. Happy squint eyes and a **closed** stroke smile (`M57 76Q70 88 83 76`) — not an open mouth. Money-rain confetti (coins and small bills falling past Bill, `data-mascot-fx="success"` / `data-mascot-rain`). No star sparkles.

### Celebrate (reimbursement / settle)

Not a bigger success. Receipt halves clap (`data-mascot-clap="true"`): split, meet, split a little, meet. Coin burst plus the same star sparkles (`data-mascot-fx="celebrate"` / `data-mascot-sparkles`). Same squint eyes, slightly wider closed smile. Whole-body motion stays small so the clap reads.

### Acknowledge (delete / archive / leave)

A short stick-arm flick (`data-mascot-arm="toss"`, also behind the body) toward a small trash can. Lid snaps open, a scrap drops in, can fades (`data-mascot-fx="acknowledge"`). Whole pose is ~0.7s; duration 1200ms. A tiny nod is punctuation, not the pose.

### Thinking

Slow bob plus three orbiting dots. Neutral mouth.

### Failure

Horizontal shake, worried brows, frown, one falling tear.

### Open (speed-dial)

Halves split on a spring; twin faces appear. Paper, outline, and print stay the same as idle — no tint wash and no halo in the gap. Independent of reaction poses. Action chips and labels use an opaque lifted fill (no backdrop blur), a modest drop shadow, and a thin rim. Dark mode adds a faint primary edge — not a neon bloom. The primary create action keeps `bg-primary` so the plus stays high-contrast. The `+` badge sits on the host trigger’s start/top corner.

## Adding a character

1. New folder `characters/<id>/` with a component that implements [`MascotCharacterProps`](./mascot-character.ts) for every reaction above.
2. Register it in [`mascot-registry.ts`](./mascot-registry.ts).
3. Add the id to `accountMascotValues` (domain) and the web `AccountMascot` union, plus i18n via `bun i18n`.
4. Host, landing, settings preview, and the expense FAB already go through the registry — no `=== 'bill'` checks.

Swapping the active mascot is changing the preference value. Do not teach mutations a character name.
