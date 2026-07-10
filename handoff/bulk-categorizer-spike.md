# Bulk Categorizer — Spike Handoff

Status: partially built, rework planned. Calibration stays synchronous and
user-facing; the final conversion (preview + save) should move to a durable
background job that reports progress and completion.

## Current feature shape

The bulk categorizer is an admin-only wizard at
`/groups/bulk-categorize/$groupId`.

- **Intro** — shows eligible (uncategorized, non-reimbursement) expense count.
- **Calibration** — synchronous AI step. The server picks a representative
  sample from a candidate pool, the admin corrects it, and corrections feed the
  next round. The AI may exit early (no more feedback needed) after one round.
- **Preview** — synchronous AI step. The server categorizes the full candidate
  set and the admin reviews/overrides before saving.
- **Done** — summary of applied changes.

Relevant files:

| Layer               | Path                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Wizard orchestrator | `apps/web/src/app/groups/[groupId]/bulk-categorize/bulk-categorize-page.tsx`                  |
| Wizard state        | `apps/web/src/app/groups/[groupId]/bulk-categorize/bulk-categorize-wizard-state.ts`           |
| Steps               | `apps/web/src/app/groups/[groupId]/bulk-categorize/{intro,calibration,preview,done}-step.tsx` |
| Route + flag guard  | `apps/web/src/routes/groups/bulk-categorize/$groupId.lazy.tsx`                                |
| Settings entry      | `apps/web/src/app/groups/[groupId]/edit/edit-group.tsx`                                       |
| Calibration API     | `apps/api/src/trpc/routers/ai/bulkCategorize/calibrate.procedure.ts`                          |
| Preview API         | `apps/api/src/trpc/routers/ai/bulkCategorize/preview.procedure.ts`                            |
| Candidate list API  | `apps/api/src/trpc/routers/ai/bulkCategorize/listCandidates.procedure.ts`                     |
| Apply API           | `apps/api/src/trpc/routers/groups/expenses/bulkUpdateCategories.procedure.ts`                 |
| AI call wrapper     | `apps/api/src/lib/ai/categorize.ts`                                                           |
| Bulk DB ops         | `apps/api/src/lib/api/category-bulk.ts`                                                       |
| Limits/constants    | `packages/domain/src/ai-limits.ts`                                                            |
| Feature flags       | `apps/api/src/trpc/routers/features/index.ts`, `apps/web/src/lib/featureFlags.ts`             |

## Frontend gating

The feature is hidden behind `PUBLIC_ENABLE_BULK_CATEGORIZE` (default `false`).
Both the settings entry point (`edit-group.tsx`) and the route guard
(`$groupId.lazy.tsx`) respect it. Backend procedures remain callable by admins
regardless of the flag; the flag is a frontend-only gate.

## Problem observed

- **Calibration is slow.** It is one synchronous AI call with a representative
  sample; perceived latency is tolerable but still blocks the request while the
  model responds.
- **Preview is much slower and is the real bottleneck.** It categorizes up to
  `BULK_PREVIEW_MAX_TARGETS` (currently 500) expenses by splitting them into
  chunks of `BULK_PREVIEW_CHUNK_SIZE` (25) and running **one sequential AI call
  per chunk** inside a single tRPC mutation. With 500 expenses that is ~20
  back-to-back blocking calls, all holding the HTTP connection open. Latency
  grows linearly with expense volume and routinely exceeds comfortable request
  timeouts.
- The whole flow is synchronous inside the tRPC request lifecycle. There is no
  job persistence, status endpoint, polling, SSE, or WebSocket today.

## Spike target

Keep calibration interactive and synchronous (it is fast enough and benefits
from immediate admin feedback). Move the **final conversion** — preview
generation across the whole set plus the apply step — into a durable background
job the server runs after the admin confirms the calibrations, then report
progress and completion back to the client.

## Open decisions for the spike

- **Job runner / storage.** No queue or worker exists. Options: a DB-backed job
  row + in-process worker, or introduce a real queue. Need to decide given the
  monolith deploy model.
- **Status + completion.** Client needs to poll a status query (or SSE) and be
  notified on completion. No polling/SSE infrastructure exists today.
- **Snapshot semantics.** Capture candidate set / calibration corrections at job
  creation so later edits don't shift the target mid-job.
- **Chunk concurrency / rate limits.** Preview chunks are currently sequential;
  the job can parallelize within provider limits and add backoff.
- **Apply atomicity.** Apply in one transaction (current behavior) vs. streaming
  incremental updates as chunks complete.
- **Retry / idempotency.** Define what happens on provider timeout/partial
  failure: resume, re-run chunk, or mark job failed with partial results.

## Notes

- Temporary diagnostics (console logs, `AI_BULK_STREAM_DEBUG`, request-id
  tracing) have been removed; only operational safeguards remain (explicit
  timeout + zero SDK retries in `callBulkCategorizationModel`).
- Iterative calibration correctness depends on threading prior admin corrections
  as ground truth into later rounds and the preview — preserve that path.
