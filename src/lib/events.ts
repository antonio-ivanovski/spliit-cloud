import { ActivityType } from '@prisma/client'

export type SpliitEvent = {
  type: ActivityType
  groupId: string
  data: Record<string, unknown>
  timestamp: Date
}

const eventHandlers: Array<(event: SpliitEvent) => Promise<void>> = []

export function registerEventHandler(
  handler: (event: SpliitEvent) => Promise<void>,
) {
  eventHandlers.push(handler)
}

export async function emitEvent(event: SpliitEvent) {
  await Promise.allSettled(eventHandlers.map((handler) => handler(event)))
}
