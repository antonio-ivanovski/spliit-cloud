export function appendImportedFromNote(
  existing: string | null | undefined,
  sourceUrl: string | null | undefined,
): string | undefined {
  const trimmedExisting = existing?.trim()
  const trimmedUrl = sourceUrl?.trim()
  if (trimmedExisting && trimmedUrl) {
    return `${trimmedExisting}\n\nImported from: ${trimmedUrl}`
  }
  if (trimmedExisting) return trimmedExisting
  if (trimmedUrl) return `Imported from: ${trimmedUrl}`
  return undefined
}
