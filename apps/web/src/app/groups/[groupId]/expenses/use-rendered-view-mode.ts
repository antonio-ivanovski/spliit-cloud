import { useRef } from 'react'

/**
 * Which expense view mode the timeline should render right now.
 *
 * Switching modes (`For you` ↔ `All`) changes the list query key, so the query
 * briefly serves placeholder (previous-mode) rows while refetching. Rendering
 * those stale rows under the _new_ mode would flash a half-state (e.g. raw rows
 * rendered collapsed, or involving rows rendered flat), so the previous mode
 * stays frozen until fresh rows arrive — then both flip together in a single
 * clean swap.
 */
export function useRenderedViewMode(
  showAll: boolean,
  isPlaceholderData: boolean,
): boolean {
  const renderedRef = useRef(showAll)
  if (!isPlaceholderData) {
    // oxlint-disable-next-line react/refs -- freeze the previous mode while placeholder rows render; a state+effect version would flip one frame late and cascade.
    renderedRef.current = showAll
  }
  // oxlint-disable-next-line react/refs -- read the frozen mode during the placeholder render (see above).
  return isPlaceholderData ? renderedRef.current : showAll
}
