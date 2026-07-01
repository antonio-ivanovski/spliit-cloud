## MODIFIED Requirements

### Requirement: Source step lists available providers

The source step SHALL present a tabbed UI with "From Spliit" (active by default) and "From Splitwise" as provider tabs that have full file-upload flows, and "Tricount" and "Settle Up" as "coming soon" tabs. The Spliit tab exposes drag-and-drop file upload (JSON/CSV) and a URL paste input for `spliit.app` group URLs. The Splitwise tab exposes drag-and-drop file upload for `.csv` only.

The file handler dispatches the parser based on the **active provider tab and the file extension** (via `pickParser(provider, fileName)` driven by a per-provider `PROVIDERS` config table). It does NOT auto-detect the file format by header shape and does NOT brute-force both parsers. Each parser still validates its own header strictly and returns `{ ok: false }` when the file does not match its expected format; the source step surfaces that error and does not advance.

#### Scenario: Spliit tab shows file upload and URL input

- **WHEN** the user opens the source step
- **THEN** the Spliit tab is active by default and shows drag-and-drop file upload (JSON/CSV) and a URL paste input for `spliit.app` group URLs

#### Scenario: Splitwise tab shows file upload

- **WHEN** the user selects the Splitwise tab
- **THEN** the Splitwise tab shows drag-and-drop file upload for `.csv` files (accept attribute restricts to `.csv,text/csv`)
- **AND** the tab does NOT show a "coming soon" placeholder card

#### Scenario: Drop zone works on the Splitwise tab

- **WHEN** the user drags a `.csv` file over the Splitwise tab's drop zone
- **THEN** the drop zone is highlighted and the file is accepted

#### Scenario: Wrong format on the active tab is rejected

- **WHEN** the user drops a file whose extension does not match the active provider's accepted types (e.g. a `.json` on the Splitwise tab, a `.txt` on the Spliit tab)
- **THEN** `pickParser` returns `{ format: null }`, the source step surfaces the `unsupportedFileType` error, and the wizard does not advance

#### Scenario: Wrong shape on the active tab is rejected

- **WHEN** the user drops a CSV whose header does not match the active provider's expected parser (e.g. a Spliit-shaped CSV on the Splitwise tab)
- **THEN** the parser returns `{ ok: false }` with a clear header-mismatch error, the source step surfaces that error, and the wizard does not advance

#### Scenario: Tricount and Settle Up remain coming soon

- **WHEN** the user selects the Tricount or Settle Up tab
- **THEN** the UI renders a card with a clock icon and a localized "coming soon" message