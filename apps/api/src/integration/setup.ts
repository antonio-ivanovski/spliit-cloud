import { prisma } from '@spliit/db'

let dbReachable = false

export async function checkDbConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbReachable = true
    return true
  } catch {
    return false
  }
}

export function isDbReachable() {
  return dbReachable
}

/** Unique identifier for a single test-run across parallel workers. */
let runCounter = 0
export function testRunId(): string {
  runCounter++
  return `int-${Date.now()}-${runCounter}-${Math.random().toString(36).slice(2, 6)}`
}
