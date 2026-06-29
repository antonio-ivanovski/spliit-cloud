export function stripThinking(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

export function getLastNonEmptyLine(content: string) {
  return (
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractAllowedIdFromAIResponse(
  rawContent: string | null | undefined,
  validIds: string[],
) {
  if (!rawContent) return null

  const content = stripThinking(rawContent)
  const trimmed = content.trim()

  if (validIds.includes(trimmed)) return trimmed

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (validIds.includes(line)) return line
  }

  for (const id of validIds) {
    const idPattern = new RegExp(
      `(^|[^a-zA-Z0-9_-])${escapeRegExp(id)}([^a-zA-Z0-9_-]|$)`,
    )
    if (idPattern.test(content)) return id
  }

  return null
}
