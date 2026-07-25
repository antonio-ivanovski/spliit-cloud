/**
 * The handlers now live in the API package so the API can also register them
 * when JOBS_INLINE=true. Re-exported here to keep the worker's own entrypoint
 * and tests unchanged.
 */
export { handlers } from '@spliit/api/lib/jobs/handlers'
