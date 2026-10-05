import { describe, expect, it } from 'vitest'

import {
  extractAnnouncementSections,
  parseAnnouncementFile,
  renderAnnouncementHtml,
  renderAnnouncementText,
  validateAnnouncementBody,
} from './markdown'

const SOURCE = `---
id: test-entry
date: 2026-09-25
title: Test title
inApp: true
email: true
---

Intro paragraph.

- [First](https://example.com/a): description one.
- [Second](https://example.com/b): description two.
`

describe('announcement markdown', () => {
  it('parses frontmatter and body', () => {
    const parsed = parseAnnouncementFile(SOURCE)
    expect(parsed.frontmatter).toEqual({
      id: 'test-entry',
      date: '2026-09-25',
      title: 'Test title',
      inApp: true,
      email: true,
    })
    expect(parsed.body).toContain('- [First]')
  })

  it('rejects images, html, and non-https links', () => {
    expect(() =>
      validateAnnouncementBody('![alt](https://example.com/x.png)'),
    ).toThrow()
    expect(() => validateAnnouncementBody('<div>hi</div>')).toThrow()
    expect(() => validateAnnouncementBody('[x](http://example.com)')).toThrow()
    expect(() => validateAnnouncementBody('```\ncode\n```')).toThrow()
  })

  it('renders the same body to html and text', () => {
    const { body } = parseAnnouncementFile(SOURCE)
    const html = renderAnnouncementHtml(body)
    expect(html).toContain('<p>Intro paragraph.</p>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<a href="https://example.com/a">First</a>')
    const text = renderAnnouncementText(body)
    expect(text).toContain('Intro paragraph.')
    expect(text).toContain('- First (https://example.com/a)')
  })

  it('wraps h2 groups in sections with anchored headings', () => {
    const body =
      'Intro.\n\n## First section\n\nBody one.\n\n## Second section\n\nBody two.\n'
    const html = renderAnnouncementHtml(body, {
      idPrefix: 'test-entry',
    })
    expect(html).toContain('<p>Intro.</p>')
    expect(html).toContain('<section class="announcement-section">')
    expect(html).toContain(
      '<h2 id="test-entry--first-section" class="announcement-heading group">' +
        '<a class="announcement-anchor" href="#test-entry--first-section" tabindex="-1" aria-hidden="true">',
    )
    expect(html).toContain('href="#test-entry--second-section"')
    expect(html.indexOf('</section>')).toBeGreaterThan(0)
    const text = renderAnnouncementText(body)
    expect(text).toContain('## First section')
    expect(text).toContain('## Second section')
    expect(text).not.toContain('announcement-anchor')
  })

  it('leaves h1 headings without a self-link anchor', () => {
    const html = renderAnnouncementHtml('# Top title\n\nBody.\n', {
      idPrefix: 'test-entry',
    })
    expect(html).toContain('<h1>Top title</h1>')
    expect(html).not.toContain('announcement-anchor')
  })

  it('derives heading ids from the reference body across locales', () => {
    const reference =
      'Intro.\n\n## First section\n\nBody one.\n\n### Sub point\n\nMore.\n'
    const localized =
      'Intro (de).\n\n## Erster Abschnitt\n\nText eins.\n\n### Unterpunkt\n\nMehr.\n'
    const html = renderAnnouncementHtml(localized, {
      idPrefix: 'test-entry',
      referenceBody: reference,
    })
    expect(html).toContain(
      '<h2 id="test-entry--first-section" class="announcement-heading group">',
    )
    expect(html).toContain('href="#test-entry--first-section"')
    expect(html).toContain('<h3 id="test-entry--sub-point"')
    expect(html).not.toContain('erster-abschnitt')
    const sections = extractAnnouncementSections(localized, {
      idPrefix: 'test-entry',
      referenceBody: reference,
    })
    expect(sections.map((section) => section.id)).toEqual([
      'test-entry--first-section',
      'test-entry--sub-point',
    ])
    // Localized display titles are preserved; only ids are reference-based.
    expect(sections.map((section) => section.title)).toEqual([
      'Erster Abschnitt',
      'Unterpunkt',
    ])
  })

  it('falls back to local slugs for headings beyond the reference', () => {
    const html = renderAnnouncementHtml(
      '## Erster Abschnitt\n\nText.\n\n## Extra Bereich\n',
      { idPrefix: 'test-entry', referenceBody: '## First section\n\nBody.\n' },
    )
    expect(html).toContain('id="test-entry--first-section"')
    expect(html).toContain('id="test-entry--extra-bereich"')
  })

  it('extracts sections with unique ids', () => {
    const body =
      '## Same title\n\nBody.\n\n## Same title\n\nMore.\n\n### Sub point\n'
    const sections = extractAnnouncementSections(body, {
      idPrefix: 'test-entry',
    })
    expect(sections.map((section) => section.id)).toEqual([
      'test-entry--same-title',
      'test-entry--same-title-2',
      'test-entry--sub-point',
    ])
    expect(sections.map((section) => section.title)).toEqual([
      'Same title',
      'Same title',
      'Sub point',
    ])
  })

  it('keeps underscores inside urls intact in html and text', () => {
    const html = renderAnnouncementHtml(
      '[a_b](https://example.com/foo_bar_baz)',
    )
    expect(html).toContain('<a href="https://example.com/foo_bar_baz">a_b</a>')
    expect(html).not.toContain('<em>')
    const text = renderAnnouncementText('[a](https://example.com/foo_bar_baz)')
    expect(text).toContain('a (https://example.com/foo_bar_baz)')
    const bareText = renderAnnouncementText(
      'See https://example.com/foo_bar_baz now',
    )
    expect(bareText).toContain('https://example.com/foo_bar_baz')
    const bareHtml = renderAnnouncementHtml(
      'See https://example.com/foo_bar_baz now',
    )
    expect(bareHtml).toContain(
      '<a href="https://example.com/foo_bar_baz">https://example.com/foo_bar_baz</a>',
    )
  })

  it('does not linkify or emphasize inside code spans', () => {
    const html = renderAnnouncementHtml('`https://example.com`')
    expect(html).toContain('<code>https://example.com</code>')
    expect(html).not.toContain('<a href')
    const nested = renderAnnouncementHtml(
      '[https://example.com](https://example.com)',
    )
    expect(nested).toContain('<a href="https://example.com">')
    expect(nested.match(/<a /g)).toHaveLength(1)
  })
})
