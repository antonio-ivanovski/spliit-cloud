import { readFileSync, writeFileSync } from 'node:fs'

import { z } from 'zod'

const manifestSchema = z.object({
  widgets: z.record(
    z.string(),
    z
      .object({
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  ),
})

export function configureBuiltWidgetDomain(
  manifestPath: URL,
  mcpPublicUrl: string,
) {
  const domain = new URL(mcpPublicUrl).origin
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
  )
  const expensePreview = manifest.widgets['expense-preview']
  if (!expensePreview) {
    throw new Error('Built expense-preview widget metadata is missing')
  }

  expensePreview.metadata = {
    ...expensePreview.metadata,
    domain,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return domain
}
