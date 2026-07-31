import { JOB_NAMES, sendJob } from '@spliit/jobs'

import { getApiBoss } from '../api/boss'

/**
 * Expense writes should feel immediate, but a queue outage must not turn an
 * already-committed expense mutation into an apparent failure. The daily
 * evaluator remains the durable fallback.
 */
export async function enqueueBudgetEvaluation(groupId: string): Promise<void> {
  try {
    const boss = await getApiBoss()
    if (!boss) return
    await sendJob(
      boss,
      JOB_NAMES.EVALUATE_BUDGETS,
      { groupId },
      { singletonKey: `budget-evaluate:${groupId}` },
    )
  } catch (error) {
    console.warn('[budgets] failed to enqueue immediate evaluation', {
      groupId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
