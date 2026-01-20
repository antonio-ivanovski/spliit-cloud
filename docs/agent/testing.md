# Testing

## Unit Tests (Jest)

```bash
npm test                          # Run all tests
npm test -- --watch               # Watch mode
npm test -- path/to/file.test.ts  # Specific file
```

- Tests in `src/**/*.test.ts` alongside implementation
- Focus: utility functions and business logic (`balances.test.ts`, `totals.test.ts`, `currency.test.ts`)
- Uses `jest-mock-extended` for type-safe mocking
- Pattern: create test data factories (e.g., `makeExpense()` helper) for cleaner tests

## End-to-End Tests (Playwright)

```bash
npm run test-e2e
```

- Tests in `tests/e2e/*.spec.ts` and `tests/*.spec.ts`
- Helpers in `tests/helpers/` for form actions, navigation, group/expense creation

### Stability Patterns

- Use `page.waitForLoadState()` after navigation to avoid race conditions
- Use `page.waitForURL()` with regex patterns after form submissions
- Use `createGroupViaAPI()` instead of UI flows to speed up test setup
- `fullyParallel: false` in config prevents database conflicts

### Configuration

- Runs against local dev server (auto-started via `webServer` config)
- Tests run across Chromium, Firefox, WebKit
- Uses `json` reporter when `CLAUDE_CODE` or `OPENCODE` env vars detected

### Common Patterns

- Use helpers: `createExpense()`, `navigateToExpenseCreate()`
- Use `randomId()` for unique group/expense names
