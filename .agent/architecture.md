# Architecture Notes

Only the non-obvious project shape:

- Web is a React/Vite SPA using TanStack Router. `apps/web/src/router.tsx` owns route registration, while route/page components are stored in `apps/web/src/app/`.
- API is Hono with `/trpc/*`, `/health`, export routes, and upload presign routes in `apps/api/src/server.ts`.
- tRPC root router exports `AppRouter` from `apps/api/src/trpc/routers/_app.ts`; the web app imports that type through `@spliit/api/router`.
- Shared business/domain code belongs in `packages/domain/` when it is not API-specific. DB writes and read orchestration belong in `apps/api/src/lib/api.ts`.
- Feature flags are split: browser-facing helpers in `apps/web/src/lib/featureFlags.ts`, runtime API flags through `apps/api/src/trpc/routers/features`.

## Expense Document Uploads & S3 Lifecycle

Expense document uploads go client → R2 directly via presigned URLs (`apps/api/src/routes/upload.ts`). The server only vends the URL; the browser PUTs the file.

**S3 tagging lifecycle** for orphan cleanup:

1. **On presign (`apps/api/src/routes/upload.ts:137`)**: `PutObjectCommand` includes `Tagging: 'status=unowned'` so every fresh upload is tagged as unowned.
2. **On expense commit (`apps/api/src/lib/api.ts`)**: `markS3ObjectAsOwned(doc.url)` flips the tag to `status=owned` — called in both `createExpense` (line 232) and `updateExpense` (line 458).
3. **On delete (`apps/api/src/lib/api.ts:258`)**: `deleteS3Object(doc.url)` removes the object entirely — called in `deleteExpense` and also in `updateExpense` for documents removed from the form (line 352).

**Bucket lifecycle rule**: Configured via S3 API (not the R2 dashboard — it only supports prefix filters). Delete objects tagged `status=unowned` after 1 day:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url https://<account_id>.r2.cloudflarestorage.com \
  --bucket <bucket> \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "delete-unowned-documents",
      "Status": "Enabled",
      "Filter": { "Tag": { "Key": "status", "Value": "unowned" } },
      "Expiration": { "Days": 1 }
    }]
  }'
```

This covers the gap where a user uploads a document in the expense form but never creates the expense (closes tab, refreshes, etc.).

**Client-side resize pipeline** (`apps/web/src/lib/upload.tsx`):
- Detects HEIC/HEIF via MIME type and lazy-imports `heic-to` for conversion to JPEG.
- Resizes to max 2560px on the longest edge.
- Re-encodes as JPEG at 80% quality.
- Server enforces a 2 MB limit (`apps/api/src/routes/upload.ts:23`).

## Data Units

- `Expense.amount`, `originalAmount`, and `BY_AMOUNT` shares are integer cents.
- `BY_PERCENTAGE` shares are basis points out of `10000`.
- `EVENLY` usually stores `shares = 1` for each participant.
- `BY_SHARES` stores relative weights.
