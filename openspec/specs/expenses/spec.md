## Purpose

Defines expense form and expense behavior requirements: cross-currency conversion (fiat and crypto), recurring template conversion, recurring copy behavior, occurrence-specific attachments, and the participant distribution editors — including decimal share entry, input canonicalization and focus behavior, share steppers, selection actions, and exact percentage/amount residual handling.

## Requirements

### Requirement: Converted expense input preservation
The system SHALL accept expense monetary inputs in the selected expense currency via a discriminated `conversion` field (`none` | `custom` | `exchange`), persist flat conversion columns, and compute ledger-currency totals server-side. Supported catalog currencies include fiat ISO codes and crypto assets (3–4 character codes).

#### Scenario: Create expense with exchange conversion
- **WHEN** a user creates an expense with `conversion: { type: 'exchange', currency }` against a different supported ledger currency (including crypto↔fiat or crypto↔crypto)
- **THEN** the client submits expense-currency `amount` and the conversion discriminant; the server resolves the rate, persists `conversionSource = EXCHANGE`, original amount/currency, rate, and the server-computed ledger total

#### Scenario: Create expense with custom conversion
- **WHEN** a user creates an expense with `conversion: { type: 'custom', currency, rate }`
- **THEN** the server applies that rate and persists `conversionSource = CUSTOM` with original amount/currency and ledger total

#### Scenario: Create same-currency expense
- **WHEN** a user creates an expense without a `conversion` field (group currency)
- **THEN** the server persists `conversionSource = null`, null rate/original fields, and the amount as ledger minor units

#### Scenario: Update converted expense
- **WHEN** a user updates amount, currency, conversion type/rate, date, or amount-based splits
- **THEN** the server recomputes ledger total and conversion columns from the submitted conversion discriminant

### Requirement: Conversion source selection in the UI
The system SHALL let users choose exchange or custom conversion when currencies differ, map that choice to the conversion discriminant on submit, and restore the correct UI from `conversionSource` on edit. The expense currency selector SHALL list supported fiat and crypto catalog entries.

#### Scenario: Switch to custom rate
- **WHEN** a user uses the custom-rate action
- **THEN** the form sets conversion type `CUSTOM` and requires a positive rate

#### Scenario: Switch to exchange rate
- **WHEN** a user uses the exchange-rate action
- **THEN** the form sets conversion type `EXCHANGE`, previews a rate from the API, and does not open the custom rate input on reopen after save

#### Scenario: Exchange provider attribution
- **WHEN** the exchange option is active and a rate is shown
- **THEN** the UI shows localized provider attribution with links to Frankfurter and Coinbase APIs, including intermediary currency and per-leg providers when the rate was bridged

### Requirement: Expense amount decimal precision
The main expense amount field, item unit prices, and paid-by/paid-for amount inputs in the expense currency SHALL enforce the selected currency's `decimal_digits` while typing and SHALL use a matching amount placeholder (fractional digits capped at four for display).

#### Scenario: Item unit price respects group currency decimals
- **WHEN** a group uses JPY (0 decimals) and the user edits an item unit price
- **THEN** fractional input beyond zero decimal places is truncated

#### Scenario: Crypto expense amount respects catalog decimals
- **WHEN** a user enters an amount in BTC (8 decimal digits in catalog, 4 in placeholder)
- **THEN** typing is capped at eight fractional digits and the placeholder shows up to four zeros after the decimal point

### Requirement: Converted expense previews
The client SHALL treat converted amount previews as illustrative only; the server SHALL remain the persistence authority for ledger totals.

#### Scenario: Future date uses today rate messaging
- **WHEN** the expense date is in the future and conversion type is `exchange`
- **THEN** preview and save use today's rate and the UI discloses this

### Requirement: Server-side import conversion
Import SHALL send expense-currency amounts and a conversion discriminant; the server SHALL resolve conversion with the same rules as create, including crypto currencies.

#### Scenario: Import with exchange rates
- **WHEN** an import batch uses per-date exchange rates
- **THEN** each expense is submitted with `conversion.type = 'exchange'` and expense-currency amounts; the server resolves rates and stores ledger totals

#### Scenario: Import with fixed custom rates
- **WHEN** an import batch uses fixed rates
- **THEN** each expense is submitted with `conversion.type = 'custom'` including the rate

### Requirement: Recurring expense conversion template
The system SHALL preserve CUSTOM conversion rates and SHALL resolve EXCHANGE rates on each generated occurrence date.

#### Scenario: Custom conversion repeats fixed rate
- **WHEN** a recurring template uses CUSTOM conversion
- **THEN** every generated occurrence uses the configured custom rate

#### Scenario: Exchange conversion uses occurrence date
- **WHEN** a recurring template uses EXCHANGE conversion
- **THEN** materialization requests the rate for that occurrence date and stores the resolved rate and ledger amount

#### Scenario: Exchange lookup failure
- **WHEN** the rate provider fails
- **THEN** no partial expense is created and the recurring job fails for retry

### Requirement: Recurring copy behavior
The system SHALL copy recurrence frequency, interval, and termination into a new independent series when making an expense copy.

#### Scenario: Copy recurring expense
- **WHEN** a user makes a copy of a recurring expense and saves it
- **THEN** a new series begins at sequence one with the copied recurrence configuration and the copying account as creator

### Requirement: Recurring attachments are occurrence-specific
Generated recurring expenses SHALL NOT copy document attachments from the template expense.

#### Scenario: Generated occurrence omits documents
- **WHEN** a template expense contains receipt documents
- **THEN** its generated occurrences contain no copied document references

### Requirement: Decimal shares across participant editors
Every participant distribution editor SHALL accept BY_SHARES decimal values with up to two decimal places: the flat paid-for editor, the multi-payer paid-by editor, the item modal, and the itemized-remainder editor. Entering `1.5` or `0.5` SHALL be possible in each editor and SHALL serialize to the fixed units `150` and `50`.

#### Scenario: Decimal share entry in paid-for
- **WHEN** a user types `1.5` in a paid-for share input
- **THEN** the row keeps the displayed `1.5` and submits fixed units `150`

#### Scenario: Decimal share entry in paid-by
- **WHEN** a user types `0.5` in a multi-payer paid-by share input
- **THEN** the row keeps the displayed `0.5` and submits fixed units `50`

#### Scenario: Decimal share entry in the item modal
- **WHEN** a user types a decimal share in an item's BY_SHARES distribution
- **THEN** the item row keeps the displayed value and submits the corresponding fixed units

### Requirement: Share input canonicalization and focus behavior
Share inputs SHALL canonicalize leading zeros while typing (`04` -> `4`, `00` -> `0`, `000.10` -> `0.10`) and SHALL keep visible intermediate input states such as `0.`, `1.`, or `0.10` alive while the user is typing, never round-tripping the raw string through `Number()`. Focusing a participant value input in paid-for, paid-by, or the item modal SHALL select the complete existing value so that typing replaces it immediately; the selection SHALL happen on initial focus (mouse, touch, or keyboard) for BY_AMOUNT, BY_PERCENTAGE, and BY_SHARES inputs, while later clicks may still place the caret.

#### Scenario: Leading zeros canonicalize
- **WHEN** a user types `004` or `000.10` into a share input
- **THEN** the displayed value canonicalizes to `4` or `0.10` without losing focus or the fractional state

#### Scenario: Intermediate decimal state survives
- **WHEN** a user types `1` then `.` into a share input
- **THEN** the displayed value remains `1.` so the fractional digits can be finished, and the serialized value is correct after completion

#### Scenario: Focus selects the value so typing replaces
- **WHEN** a prefilled share, percentage, or amount input receives focus
- **THEN** the full value is selected (selection spans the whole value), and typing the next character replaces it without a manual clear

### Requirement: Fractional share stepper rule
The share stepper SHALL step by 0.1 for any value with a fractional part, regardless of magnitude, and by 1 for numerically whole values: `0.5 +` yields `0.6`, `1.1 +` yields `1.2`, `1.5 +` yields `1.6`, `1.9 +` yields `2`, `2 +` yields `3`, and `1.5 -` yields `1.4`. The rule SHALL depend on numeric integrality (a numerically whole `1.0` steps by 1 even when the form state retains a trailing `.0`). Results SHALL be rounded to two decimal places, clamped to the valid display range, and a decrement to zero SHALL remove the row in every editor (paid-for, paid-by, and item modal).

#### Scenario: Fractional values step by 0.1
- **WHEN** a share with a fractional part is stepped up or down
- **THEN** the value changes by 0.1 (e.g., `1.5 +` -> `1.6`, `2.75 +` -> `2.85`, `1.5 -` -> `1.4`)

#### Scenario: Whole values step by 1
- **WHEN** a numerically whole share is stepped
- **THEN** the value changes by 1 (e.g., `2 +` -> `3`), including values like `1.0`

#### Scenario: Stepping to zero removes the row
- **WHEN** a stepper decrement reaches zero in the paid-for, paid-by, or item editor
- **THEN** the participant row is removed from the distribution

### Requirement: Participant selection actions
The participant editors SHALL expose Select all, Select none, and Reset with distinct semantics: Select all SHALL add missing participants at the mode's default value without overwriting edited values; Select none SHALL clear every row; Reset SHALL rebuild the distribution equally for the current mode, overwriting every value so edited rows return to automatic balancing.

#### Scenario: Select all preserves edits
- **WHEN** a user edits one participant's value and then selects all
- **THEN** the edited value is preserved and missing participants are added at the default value

#### Scenario: Reset rebuilds equally
- **WHEN** a user resets a BY_AMOUNT, BY_PERCENTAGE, or BY_SHARES distribution
- **THEN** every participant receives the mode's equal distribution (`10.00` over three BY_AMOUNT rows becomes `3.33 / 3.33 / 3.34`)

#### Scenario: Reset rows stay automatic
- **WHEN** the amount changes after a Reset
- **THEN** the rows rebalance automatically (e.g., `11.00` becomes `3.66 / 3.67 / 3.67`), proving Reset did not mark the rows as manually edited

### Requirement: Exact percentage and amount residual handling
Percentage distributions SHALL sum to exactly 100% (10000 basis points). BY_AMOUNT automatic balancing SHALL distribute the remaining amount over the automatic rows with the residual cent on the later rows so the rows sum exactly to the target (`10.00` over three rows becomes `3.33 / 3.33 / 3.34`, not `3.33 × 3 = 9.99`). Automatic rows that receive a zero allocation (e.g., fewer cents than participants) SHALL be omitted from the list so their checkbox unselects; a transient zero or cleared amount SHALL NOT collapse the automatic rows while the user retypes.

#### Scenario: Percentage reset totals exactly 100
- **WHEN** a percentage distribution is reset
- **THEN** the shares sum to exactly `100` (basis points 10000)

#### Scenario: Amount reset preserves the residual cent
- **WHEN** a BY_AMOUNT distribution of `10.00` is reset over three participants
- **THEN** the rows are `3.33 / 3.33 / 3.34`, summing exactly to `10.00`

#### Scenario: Shrinking amount omits zero rows
- **WHEN** the amount shrinks so that fewer cents remain than automatic participants (e.g., `0.02` to `0.01` over two rows)
- **THEN** exactly one participant remains selected with the full `0.01`, the other automatic row is removed (unselected), and no selected row holds a zero share
