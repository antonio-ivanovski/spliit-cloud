# Campaign asset provenance

Captured 15 October 2026 for a direct product comparison. These assets retain
Tricount, Settle Up, and Splitwise branding and identify those products; they
do not imply affiliation or endorsement.

- `tricount-oneline.svg`: unchanged black one-line Tricount lockup SVG from
  bunq's official Tricount media kit,
  https://press.bunq.com/assets/236173/
  (direct file:
  https://d21buns5ku92am.cloudfront.net/69568/documents/57100-1749720217-tricount_black_oneline-f24320.svg).
- `tricount-logo.svg`: unchanged Tricount app-icon SVG from the same official
  media kit (Asset 1,
  https://d21buns5ku92am.cloudfront.net/69568/documents/57105-1749720430-Asset%201-ebc298.svg).
  Kept as a spare; the one-line lockup is the primary mark.
- `settleup-logo.png`: unchanged Settle Up wordmark from the official site
  header, https://settleup.io/images/logo_2x.png (referenced by the official
  stylesheet https://settleup.io/css/screen.css). No official press kit or
  vector logo was available; the site header asset is the most official source.
- Splitwise logo: reused from `../splitwise-paywall-roast/assets/splitwise-logo.svg`
  (unchanged inline `header-logo` SVG from https://www.splitwise.com/pro; see
  that campaign's SOURCES.md).
- Spliit Cloud logo: imported from `apps/web/public/logo-with-text.svg`.

Factual claims and their sources:

- Tricount removed in-app CSV export; a dump is requested via support:
  https://help.tricount.com/articles/tricount-faqs (“If you'd like to export
  your tricount in CSV or ODF, reach out to us at support@bunq.com.”) and
  https://help.tricount.com/en/articles/what-happened-with-tricount-premium
  (Premium discontinued with the new app). Checked 15 October 2026.
- Settle Up shows a fullscreen ad after every third expense in the free
  version; recurring expenses, receipt photos, charts, and Excel export are
  Premium features: founder post
  https://medium.com/step-up-labs/summary-of-2025-changes-in-monetization-of-settle-up-results-7ad316d559c7
  (15 December 2025) and https://settleup.app/premium. CSV export is free,
  which the promo concedes on screen (“Free export. Fair.”).
- Tricount share-link paste, GDPR CSV drop, multi-group picker, Settle Up CSV
  drop, and the six-tab source roster are the actual import wizard UI
  (`apps/web/src/app/groups/import/`); the promo reuses the real
  PasteUrlCard, FileUploadCard, ConfirmStep, DoneStep, and StepHeader
  components. Fixture CSVs are synthetic but verified through the real domain
  parsers (`parseTricountCsvSingle`, `parseSettleUpCsv`).

Narration uses local Kokoro-82M `af_heart` at speed 1.0; the model is Apache-2.0:
https://huggingface.co/hexgrad/Kokoro-82M.
All scripts, measured clips, model identities and hashes are retained by the
existing media manifest workflow.

Music and the transition texture are generated locally with Stable Audio 3
Small-Music and Small-SFX. The recipe, seeds, pinned runtime and model hashes
are retained by the sound-design workflow. Stability's Community License applies
(free for individual creators and organizations below its annual revenue
threshold): https://stability.ai/license.
Remotion's license applies to the renderer: https://www.remotion.dev/license.
No accounts or paid licenses were created or purchased.
