## Why

The balances page currently records each suggested reimbursement as a separate expense. When one participant pays several people, this creates unnecessary repetition and makes it harder to record a real settlement batch as one ledger entry.

## What Changes

- Add participant-header settlement actions to both balance views for “pays” and “receives” groups.
- Extend the existing settlement preview with exact-amount checkboxes for compatible recommendations sharing that participant and direction.
- Create one reimbursement expense for the selected legs, while retaining the existing per-row single-payment action.
- Prefill the full multi-party reimbursement when the user chooses “Edit details”.
- Add focused UI, domain, and translation coverage.

## Capabilities

### New Capabilities

- `grouped-settlement-recording`: Record compatible suggested reimbursements as one expense from participant balance groups.

### Modified Capabilities

<!-- No existing spec requirements change; the stored expense model already supports the required payer/recipient arrays. -->

## Impact

- React balances components and responsive settlement modal in `apps/web`.
- Create-expense URL defaults for multi-party reimbursement editing.
- Existing expense creation mutation payloads; no API endpoint or database migration is required.
- Domain balance regression tests and locale message keys.
