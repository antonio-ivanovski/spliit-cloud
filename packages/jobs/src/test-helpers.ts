import type { JobWithMetadata } from 'pg-boss'
import { vi } from 'vitest'

import type { SpliitBoss } from './boss'

/**
 * Shared pg-boss test double for boss/lifecycle/registry suites.
 * Provides every method those suites touch (queue admin, send/insert,
 * findJobs, work) so each test file does not maintain its own copy.
 */
export function createBossMock(
  getQueue: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(null),
): SpliitBoss {
  return {
    getQueue,
    createQueue: vi.fn().mockResolvedValue(undefined),
    updateQueue: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('job-id'),
    findJobs: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue(['job-id-1', 'job-id-2']),
    work: vi.fn().mockResolvedValue('worker-1'),
  } as unknown as SpliitBoss
}

/** Minimal JobWithMetadata for lifecycle handler tests. */
export function makeJob<T extends object>(
  data: T,
  overrides: Partial<JobWithMetadata<T>> = {},
): JobWithMetadata<T> {
  const controller = new AbortController()
  return {
    id: 'job-id',
    name: 'notification.deliver',
    data,
    expireInSeconds: 300,
    heartbeatSeconds: null,
    signal: controller.signal,
    groupId: null,
    groupTier: null,
    priority: 0,
    state: 'active',
    retryLimit: 5,
    retryCount: 2,
    retryDelay: 30,
    retryBackoff: true,
    startAfter: new Date(),
    startedOn: new Date(),
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 86_400,
    createdOn: new Date(),
    completedOn: null,
    keepUntil: new Date(),
    policy: 'exclusive',
    heartbeatOn: null,
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: 'notification.deliver.dead-letter',
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
    ...overrides,
  } as JobWithMetadata<T>
}
