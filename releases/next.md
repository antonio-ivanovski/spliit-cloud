Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Headline one

### Headline one

A short paragraph per headline, with a screenshot where it helps.

![caption](./assets/next/shot.webp)

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Short entry per user-facing change (`TBD` by @TBD)
- Added a Tools flow to categorize existing expenses with local matching or Jev, review calibration samples and a virtualized expense table, automatically continue through calibration, rerun remaining suggestions using the user's corrections, and save selected categories atomically (`TBD` by @handle)
- Refined bulk categorization with clearer calibration scoring, responsive expense review, and a rerun suggestion that explains how corrections may help remaining General expenses (`TBD` by @handle)
- Simplified bulk categorization review into edge-to-edge expense rows with only alternative, non-General categories in quick choices (`TBD` by @handle)
- Kept rerun feedback visible after manual categorization and let reruns reconsider uncertain automatic matches; Local and Jev now run as separate categorization modes (`TBD` by @handle)
- Clarified the separate Local and Jev modes, placed match strength beside neutral category pickers, and improved virtualized expense row sizing (`TBD` by @handle)
- Improved Jev bulk suggestions with relevant reviewed examples, nearby categorized expenses, and an extra pass over General or uncertain matches before review (`TBD` by @handle)
- Showed Jev confidence and local match strength inside the bulk categorizer's category picker (`TBD` by @handle)
- Shared Local matching and category interpretation across the expense form, bulk categorizer, and CSV import, with consistent Jev validation for single and batch suggestions (`TBD` by @handle)
- Made the Tools categorizer ready for large groups with 10,000-expense runs, paged review, safe retries and concurrent edits, and a fast atomic save; remaining General expenses can be handled in another run (`TBD` by @handle)
- Gave the Tools categorizer consistent progress across rounds, page-scrolling expense review with a read-only detail preview, General filtering, and sticky save and rerun actions (`TBD` by @handle)

### 🐛 Bug fixes

- Short entry per fix (`TBD` by @TBD)
- Reset the review correction note after its feedback has been used for a categorization rerun (`TBD` by @handle)
- Keep the categorization success screen available after a refresh, with an option to start another run when General expenses remain (`TBD` by @handle)
- Prevented a Jev runner-up from being automatically selected when its primary category was General or below the confidence floor (`TBD` by @handle)
- Labeled Jev runner-up probabilities separately from primary confidence in bulk review (`TBD` by @handle)
- Corrected the bulk review's initial desktop row heights and replaced misleading full-looking loading bars with calibration spinners and accurate progress bars (`TBD` by @handle)

**Full Changelog**: TBD
