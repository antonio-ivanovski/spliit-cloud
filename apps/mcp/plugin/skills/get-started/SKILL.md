---
name: get-started
description: Create a Spliit Cloud shared expense from conversation with a safe confirmation preview.
---

# Getting started with Spliit Cloud

Spliit Cloud tracks shared group expenses. Use its tools when the user wants
to record, split, or review a shared expense.

## Workflow

1. Call `get-expense-context` first when the group ID is not already known.
   Results are already restricted to the OAuth-connected Spliit Cloud account.
2. Resolve group and participant names case-insensitively from that response.
   Ask one short clarification only when multiple distinct IDs remain
   plausible.
3. Call `prepare-expense` in the same turn once group, amount, and title are
   known. It validates access and returns the non-editable confirmation
   preview. It never creates an expense.
4. The preview button calls the widget-only `create-expense` tool. Never call
   `create-expense` conversationally and never claim the expense exists until
   the preview button succeeds.

## Rules

- Pass monetary values as decimal strings in major currency units.
- Omit payer, split, date, category, and currency only when Spliit Cloud defaults
  should apply.
- Use `get-group-summary` for balances and recent expenses, not for
  participant mapping.
- If a receipt image is unreadable or contradictory, ask one focused
  question instead of inventing values. Never send or store the image.
