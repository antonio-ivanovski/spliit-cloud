import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_DOCUMENT_TITLE,
  useDocumentTitle,
} from '@/components/document-title'
import { render } from '@/test/test-utils'

function Title({ title }: { title: string | null }) {
  useDocumentTitle(title)
  return null
}

describe('document title', () => {
  beforeEach(() => {
    document.title = ' stale group title '
  })

  it('falls back to the default title when nothing declares one', () => {
    render(<Title title={null} />)
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE)
  })

  it('applies a declared title and restores the default when removed', () => {
    const { rerender } = render(<Title title="🏖️ Trip · Expenses" />)
    expect(document.title).toBe('🏖️ Trip · Expenses')

    rerender(<></>)
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE)
  })

  it('restores the default when navigating to a page without a title', () => {
    const { rerender } = render(<Title title="🏖️ Trip · Expenses" />)
    expect(document.title).toBe('🏖️ Trip · Expenses')

    rerender(<Title title={null} />)
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE)
  })

  it('lets a nested page override its layout and restores it on unmount', () => {
    const { rerender } = render(
      <>
        <Title title="🏖️ Trip · Expenses" />
        <Title title="Spliit Cloud · New expense" />
      </>,
    )
    expect(document.title).toBe('Spliit Cloud · New expense')

    rerender(<Title title="🏖️ Trip · Expenses" />)
    expect(document.title).toBe('🏖️ Trip · Expenses')
  })

  it('keeps the nested title when the parent title updates', () => {
    const { rerender } = render(
      <>
        <Title title="🏖️ Trip · Expenses" />
        <Title title="Spliit Cloud · New expense" />
      </>,
    )
    expect(document.title).toBe('Spliit Cloud · New expense')

    // e.g. the group query resolving or the locale changing must not
    // promote the parent entry above the nested page.
    rerender(
      <>
        <Title title="🏖️ Trip · Balances" />
        <Title title="Spliit Cloud · New expense" />
      </>,
    )
    expect(document.title).toBe('Spliit Cloud · New expense')
  })
})
