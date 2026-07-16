## Context

Suggested reimbursements are currently rendered as independent `{from, to, amount}` legs. The existing responsive settlement modal creates one reimbursement expense for one leg, while the existing expense schema already supports multiple `paidBy` and `paidFor` rows. The balances Visual view already groups legs by participant and direction; the Simple view will adopt compact equivalents.

## Goals / Non-Goals

**Goals:**

- Let a participant header open a review of all compatible legs sharing that participant and direction.
- Record selected legs as one exact-amount reimbursement expense.
- Keep the existing single-row shortcut and support both payer-centric and receiver-centric groups.
- Preserve the existing responsive, accessible dialog and full expense-form edit path.

**Non-Goals:**

- Combining arbitrary many-to-many recommendation graphs.
- Mixing currencies or adding a new settlement API/mutation.
- Server-side revalidation of stale recommendations beyond the current create-expense behavior.

## Decisions

- **Group at the rendering boundary.** Build a shared settlement-group representation from the recommendation legs and use it in both balance views. A group is keyed by direction and central participant; its legs remain exact and ordered. This avoids asking the modal to infer relationships from a flat list.
- **Use the existing expense payload.** For a payer group, submit one `BY_AMOUNT` payer row and selected `paidFor` rows. For a receiver group, submit selected `BY_AMOUNT` payer rows and one `paidFor` row. This uses existing validation and Prisma relations, so no schema migration is needed.
- **Use explicit initial selection.** Header actions initialize every group leg as checked; row actions initialize only the clicked leg. The modal owns subsequent checkbox state and derives total/count from it.
- **Keep both entry points.** Header actions are labelled `Settle` and remain available for one-leg groups. Per-row `Mark as paid` remains in payer groups only, avoiding duplicated row actions when the same leg is shown in both directions.
- **Keep edit compatibility.** Single-leg edit URLs continue to use the existing scalar parameters. Multi-leg edit uses a validated serialized settlement payload containing direction, central participant, and exact legs; form defaults convert it into `BY_AMOUNT` rows.
- **Keep currency boundaries.** Groups are generated from the current currency section only. Group-currency display can combine normalized group-currency legs; Original display never crosses original-currency sections.

## Risks / Trade-offs

- [Risk] A user may uncheck every leg or select a stale recommendation. → Disable the submit action with no selected legs; preserve the current mutation/error behavior and invalidate balances after success.
- [Risk] Showing both payer and receiver groups duplicates recommendation rows. → Keep the Simple presentation compact and expose individual row actions only on payer groups; header actions make the direction explicit.
- [Risk] Serialized edit state can be malformed or too large. → Validate the payload, filter unknown participants, fall back safely to the existing scalar flow, and keep the payload limited to the selected recommendation legs.

## Migration Plan

No database or API migration is required. Deploy the UI and locale changes together; old scalar reimbursement URLs remain supported. Rollback is a code revert with no data cleanup.
