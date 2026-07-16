## 1. Settlement grouping and shared UI state

- [x] 1.1 Add shared settlement-group and leg-selection helpers for payer/receiver direction, stable leg keys, compatible legs, and summed totals.
- [x] 1.2 Update the Visual balances direction groups and Simple balances presentation to render participant headers with `Settle` actions and payer-only row shortcuts.
- [x] 1.3 Extend the responsive settlement modal to render accessible checkboxes, initial selections, live count/total, empty-selection state, and loading/error behavior.

## 2. Reimbursement creation and edit flow

- [x] 2.1 Build payer-group and receiver-group expense payloads with exact `BY_AMOUNT` shares and preserve currency conversion metadata.
- [x] 2.2 Add validated multi-settlement create-expense search state and populate the normal expense form with multiple payers or recipients for `Edit details`.
- [x] 2.3 Add grouped-settlement success copy, accessible labels, and all locale keys through the i18n workflow.

## 3. Verification

- [x] 3.1 Add domain tests proving combined payer and receiver reimbursements clear the corresponding suggested legs.
- [x] 3.2 Add component tests for header/row initial selection, checkbox totals, disabled submit, and exact outgoing/incoming mutation payloads.
- [x] 3.3 Add edit-defaults tests for valid and malformed multi-settlement URL state.
- [x] 3.4 Run targeted tests plus `bun check-types`, `bun lint`, `bun check-formatting`, and `bun i18n check`.
