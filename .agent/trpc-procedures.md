# tRPC Notes

- Procedures live under `apps/api/src/trpc/routers/`, grouped by domain.
- Use one `*.procedure.ts` file per operation and export it from the nearest router `index.ts`.
- Validate every input with Zod. Prefer shared schemas from `@spliit/domain` for form-shaped data.
- Keep procedures thin; call `apps/api/src/lib/api.ts` for DB/business operations.
- Web calls use `trpc.<router>.<procedure>.useQuery()` or `.useMutation()` from `apps/web/src/trpc/client.tsx`.

## Current Router Shape

```text
appRouter
  ai
  categories.list
  features.get
  groups.get/getDetails/list/create/update
  groups.expenses.list/get/create/update/delete
  groups.balances.list
  groups.stats.get
  groups.activities.list
```

## Serialization

SuperJSON is configured on both API and web. The web client additionally registers `decimal.js`; do not manually stringify `Date`, `Decimal`, or similar values unless an external route requires plain JSON.
