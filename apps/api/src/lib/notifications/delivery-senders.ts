import type { DeliverySnapshotV1 } from './delivery-snapshot'

export class TransientDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly providerStatus?: number,
  ) {
    super(message)
    this.name = 'TransientDeliveryError'
  }
}

export class PermanentDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly providerStatus?: number,
  ) {
    super(message)
    this.name = 'PermanentDeliveryError'
  }
}

export interface EmailDeliverySender {
  send(args: {
    deliveryId: string
    snapshot: DeliverySnapshotV1
    recipientAccountId: string
  }): Promise<void>
}

export interface PushDeliverySender {
  send(args: {
    deliveryId: string
    snapshot: DeliverySnapshotV1
    pushSubscriptionId: string
  }): Promise<void>
}

export const PROVIDER_TIMEOUT_MS = 30_000
// Nodemailer's `connectionTimeout`, `greetingTimeout`, and `socketTimeout`
// are independent phase limits, not one end-to-end deadline. In the worst
// case (each phase times out in sequence) the SMTP operation can run for the
// sum of the three timeouts. The lease must exceed that worst case so a
// slow-but-successful send cannot be reclaimed by another worker mid-flight
// (see `notification-delivery.ts`).
export const SMTP_OPERATION_BUDGET_MS = PROVIDER_TIMEOUT_MS * 3
export const DELIVERY_LEASE_MS = 120_000

export function assertDeliveryTimeoutOrdering(args: {
  providerTimeoutMs: number
  leaseDurationMs: number
  jobExpirySeconds: number
}): void {
  const smtpBudgetMs = args.providerTimeoutMs * 3
  const jobExpiryMs = args.jobExpirySeconds * 1000
  if (
    !(smtpBudgetMs < args.leaseDurationMs) ||
    !(args.leaseDurationMs < jobExpiryMs)
  ) {
    throw new Error(
      `[notifications] timeout ordering violated: smtpBudgetMs (${smtpBudgetMs}) < leaseDurationMs (${args.leaseDurationMs}) < jobExpirySeconds*1000 (${jobExpiryMs})`,
    )
  }
}
