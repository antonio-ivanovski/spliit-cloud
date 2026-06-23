# Architecture Notes

Only the non-obvious project shape:

- Web is a React/Vite SPA using TanStack Router. `apps/web/src/router.tsx` owns route registration, while route/page components are stored in `apps/web/src/app/`.
- API is Hono with `/trpc/*`, `/health`, export routes, and upload presign routes in `apps/api/src/server.ts`.
- tRPC root router exports `AppRouter` from `apps/api/src/trpc/routers/_app.ts`; the web app imports that type through `@spliit/api/router`.
- Shared business/domain code belongs in `packages/domain/` when it is not API-specific. DB writes and read orchestration belong in `apps/api/src/lib/api.ts`.
- Feature flags are split: browser-facing helpers in `apps/web/src/lib/featureFlags.ts`, runtime API flags through `apps/api/src/trpc/routers/features`.

## Data Units

- `Expense.amount`, `originalAmount`, and `BY_AMOUNT` shares are integer cents.
- `BY_PERCENTAGE` shares are basis points out of `10000`.
- `EVENLY` usually stores `shares = 1` for each participant.
- `BY_SHARES` stores relative weights.
