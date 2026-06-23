# Testing Notes

Use repository scripts:

```bash
bun run test       # turbo unit tests, mainly packages/domain Vitest tests
bun test-e2e       # Playwright from apps/web
```

## Unit Tests

- Domain tests live next to domain code in `packages/domain/src/*.test.ts`.
- Add/adjust unit tests for split math, totals, schemas, currency, and recurrence logic when touching `packages/domain`.

## E2E Tests

- Playwright tests live in `apps/web/tests/`.
- `apps/web/playwright.config.ts` starts the API and web dev servers, so `bun test-e2e` is the normal entry point.
- `fullyParallel: false` is intentional because tests share database state.
- Prefer helpers in `apps/web/tests/helpers/` for group setup, navigation, forms, and expense creation.

## What To Run

- Shared math/schema change: `bun run test`.
- API/router/schema change: `bun check-types` plus targeted e2e when behavior changes.
- UI workflow change: `bun check-types` and the relevant Playwright spec(s), or `bun test-e2e` if broad.
