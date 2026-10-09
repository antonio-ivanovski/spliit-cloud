import { randomUUID } from 'node:crypto'

export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

/** Unique deliverable address per run (the DB persists across runs). */
export function uniqueEmail(): string {
  return `${uniqueId('mail')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')}@test.local`
}

export const TEST_PASSWORD = 'E2ePass123!'
