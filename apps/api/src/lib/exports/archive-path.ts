/**
 * Convert an identifier into a path-safe archive segment.
 *
 * Archive paths are portable across ZIP readers and must not inherit path
 * separators or traversal segments from database values.
 */
export function safeArchiveSegment(
  value: string,
  fallback = 'segment',
): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return sanitized || fallback
}

export function safeArchivePrefix(prefix: string): string {
  return prefix
    .split('/')
    .filter(Boolean)
    .map((segment) => safeArchiveSegment(segment))
    .join('/')
}
