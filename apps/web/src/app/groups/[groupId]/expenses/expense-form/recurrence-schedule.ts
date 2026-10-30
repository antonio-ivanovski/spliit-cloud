/**
 * Backwards-compatible re-export. The pure web schedule math moved to
 * `@/lib/recurrence-schedule` so Personal planned transactions can reuse
 * `getRecurrencePreviewDates`/`getRecurrenceSchedule` without importing group
 * form code. Group imports stay unchanged.
 */
export * from '@/lib/recurrence-schedule'
