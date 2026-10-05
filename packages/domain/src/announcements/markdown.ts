export type AnnouncementFrontmatter = {
  id: string
  date: string
  title: string
  inApp: boolean
  email: boolean
}

export type ParsedAnnouncementFile = {
  frontmatter: AnnouncementFrontmatter
  body: string
}

const FRONTMATTER_KEYS = ['id', 'date', 'title', 'inApp', 'email'] as const

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseAnnouncementFile(source: string): ParsedAnnouncementFile {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    throw new Error('Announcement file must start with YAML frontmatter')
  }
  const [, rawFrontmatter = '', body = ''] = match
  const data: Record<string, string | boolean> = {}
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`)
    }
    const key = line.slice(0, colon).trim()
    const value = parseScalar(line.slice(colon + 1))
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unknown frontmatter key: ${key}`)
    }
    data[key] = value
  }
  const { id, date, title, inApp, email } = data
  if (
    typeof id !== 'string' ||
    typeof date !== 'string' ||
    typeof title !== 'string' ||
    typeof inApp !== 'boolean' ||
    typeof email !== 'boolean'
  ) {
    throw new Error(
      'Frontmatter must define id, date, title (strings) and inApp, email (booleans)',
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`Invalid frontmatter date: ${date}`)
  }
  if (!id || !title.trim()) {
    throw new Error('Frontmatter id and title must be non-empty')
  }
  const trimmedBody = body.trim()
  if (!trimmedBody) {
    throw new Error('Announcement body must be non-empty')
  }
  return {
    frontmatter: { id, date, title: title.trim(), inApp, email },
    body: `${trimmedBody}\n`,
  }
}

const HTTPS_URL = 'https://[^\\s)<>"]+'

export function validateAnnouncementBody(body: string): void {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      throw new Error('Code blocks are not allowed in announcements')
    }
    if (trimmed.startsWith('![') || trimmed.includes('![')) {
      if (/!\[[^\]]*\]\(/.test(line)) {
        throw new Error('Images are not allowed in announcements')
      }
    }
    if (/^<[^>]+>/.test(trimmed) && !/^<\d/.test(trimmed)) {
      throw new Error('HTML is not allowed in announcements')
    }
    if (/^\|.*\|$/.test(trimmed) && line.includes('|')) {
      throw new Error('Tables are not allowed in announcements')
    }
    if (/^#{4,}\s/.test(trimmed)) {
      throw new Error('Only h1-h3 headings are allowed in announcements')
    }
    if (trimmed.startsWith('>')) {
      throw new Error('Blockquotes are not allowed in announcements')
    }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      throw new Error('Horizontal rules are not allowed in announcements')
    }
  }
  const linkMatches = body.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)
  for (const match of linkMatches) {
    const url = match[2]!.trim()
    if (!url.startsWith('https://')) {
      throw new Error(`Only https links are allowed in announcements: ${url}`)
    }
    if (!match[1]!.trim()) {
      throw new Error('Link text must be non-empty')
    }
  }
}

export function slugifyAnnouncementHeading(value: string): string {
  const slug = stripInline(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

export type AnnouncementSection = {
  id: string
  level: 1 | 2 | 3
  title: string
}

/** Slugs for h2/h3 headings in document order, with duplicate handling. */
function slugList(body: string): string[] {
  const seen = new Map<string, number>()
  const slugs: string[] = []
  for (const block of parseBlocks(body)) {
    if (block.type !== 'heading' || block.level === 1) continue
    const base = slugifyAnnouncementHeading(block.text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    slugs.push(count === 0 ? base : `${base}-${count + 1}`)
  }
  return slugs
}

/**
 * Heading ids in document order. When a reference (en-US) body is provided,
 * slugs are taken from it by position so fragments stay identical across
 * locales — a link shared from one locale resolves in every other locale.
 * Translations preserve heading order/structure; any extra headings beyond the
 * reference fall back to their own text. Without a reference, slugs derive from
 * the body's own headings (previous behavior).
 */
function resolveHeadingIds(
  body: string,
  referenceBody: string | undefined,
  idPrefix?: string,
): string[] {
  const referenceSlugs =
    referenceBody === undefined ? null : slugList(referenceBody)
  const seen = new Map<string, number>()
  const ids: string[] = []
  let referenceIndex = 0
  for (const block of parseBlocks(body)) {
    if (block.type !== 'heading' || block.level === 1) continue
    const base =
      referenceSlugs && referenceIndex < referenceSlugs.length
        ? referenceSlugs[referenceIndex++]!
        : slugifyAnnouncementHeading(block.text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const slug = count === 0 ? base : `${base}-${count + 1}`
    ids.push(idPrefix ? `${idPrefix}--${slug}` : slug)
  }
  return ids
}

/** H2/H3 headings in document order, with the same ids the HTML renderer emits. */
export function extractAnnouncementSections(
  body: string,
  options?: { idPrefix?: string; referenceBody?: string },
): AnnouncementSection[] {
  const ids = resolveHeadingIds(body, options?.referenceBody, options?.idPrefix)
  const sections: AnnouncementSection[] = []
  let index = 0
  for (const block of parseBlocks(body)) {
    if (block.type !== 'heading' || block.level === 1) continue
    sections.push({
      id: ids[index++]!,
      level: block.level,
      title: stripInline(block.text),
    })
  }
  return sections
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

// Decorative self-link icon for h2/h3 headings. The anchor is aria-hidden and
// unfocusable: the heading text itself remains the accessible name, and the
// icon is a mouse/touch affordance only (no new translatable strings).
// Visual styling (hover visibility, spacing) lives in `AnnouncementBody`.
const HEADING_LINK_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2.83-2.83a3 3 0 0 0-4.24-4.24L7.91 3.84"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0L2.43 9.33a3 3 0 0 0 4.24 4.24l1.42-1.41"/></svg>'

function renderInlineEmphasis(value: string): string {
  let out = value
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
  return out
}

function renderInlineHtml(value: string): string {
  // Stash code spans, links, and bare URLs before running emphasis so `*`/`_`
  // inside URLs, code, or href attributes are never rewritten as <em> and
  // inserted HTML is never re-processed.
  const tokens: string[] = []
  const stash = (html: string): string => {
    tokens.push(html)
    return `\uE000${tokens.length - 1}\uE000`
  }
  let out = escapeHtml(value)
  out = out.replace(/`([^`]+)`/g, (_match, code: string) =>
    stash(`<code>${code}</code>`),
  )
  out = out.replace(
    /\[([^\]]+)\]\((https:\/\/[^\s)<>"]+)\)/g,
    (_match, label: string, url: string) =>
      stash(`<a href="${url}">${renderInlineEmphasis(label)}</a>`),
  )
  out = out.replace(/(?<!["'=])(https:\/\/[^\s)<>"]+)/g, (url: string) =>
    stash(`<a href="${url}">${url}</a>`),
  )
  out = renderInlineEmphasis(out)
  return out.replace(
    /\uE000(\d+)\uE000/g,
    (_match, index: string) => tokens[Number(index)]!,
  )
}

export type AnnouncementBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string }

export function parseAnnouncementBlocks(body: string): AnnouncementBlock[] {
  return parseBlocks(body)
}

function parseBlocks(body: string): AnnouncementBlock[] {
  const blocks: AnnouncementBlock[] = []
  const lines = body.split(/\r?\n/)
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items })
      list = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      })
      continue
    }
    const unordered = trimmed.match(/^[-*]\s+(.*)$/)
    if (unordered) {
      flushParagraph()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(unordered[1]!)
      continue
    }
    const ordered = trimmed.match(/^\d+\.\s+(.*)$/)
    if (ordered) {
      flushParagraph()
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(ordered[1]!)
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushList()
  return blocks
}

export function renderAnnouncementHtml(
  body: string,
  options?: { idPrefix?: string; referenceBody?: string },
): string {
  const blocks = parseBlocks(body)
  const ids = resolveHeadingIds(body, options?.referenceBody, options?.idPrefix)
  let headingIndex = 0
  const parts: string[] = []
  let openSection = false

  const renderBlock = (block: AnnouncementBlock): string => {
    if (block.type === 'heading') {
      const id = block.level === 1 ? null : ids[headingIndex++]
      if (block.level === 1) {
        return `<h1>${renderInlineHtml(block.text)}</h1>`
      }
      return `<h${block.level} id="${id}" class="announcement-heading group"><a class="announcement-anchor" href="#${id}" tabindex="-1" aria-hidden="true">${HEADING_LINK_ICON}</a>${renderInlineHtml(block.text)}</h${block.level}>`
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>${block.items.map((item) => `<li>${renderInlineHtml(item)}</li>`).join('')}</${tag}>`
    }
    return `<p>${renderInlineHtml(block.text)}</p>`
  }

  for (const block of blocks) {
    // Each h2 starts a new section so long posts get visual rest stops.
    // h1/h3 stay inline within the current section.
    if (block.type === 'heading' && block.level === 2) {
      if (openSection) parts.push('</section>')
      parts.push('<section class="announcement-section">')
      openSection = true
    }
    parts.push(renderBlock(block))
  }
  if (openSection) parts.push('</section>')
  return parts.join('\n')
}

export function renderAnnouncementText(body: string): string {
  const blocks = parseBlocks(body)
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'heading') {
      lines.push(`${'#'.repeat(block.level)} ${stripInline(block.text)}`)
      lines.push('')
    } else if (block.type === 'list') {
      for (const item of block.items) {
        lines.push(`- ${stripInline(item)}`)
      }
      lines.push('')
    } else {
      lines.push(stripInline(block.text))
      lines.push('')
    }
  }
  return `${lines.join('\n').trim()}\n`
}

function stripEmphasisOnly(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripInline(value: string): string {
  // Split out links, bare URLs, and code spans first so emphasis stripping
  // never rewrites characters inside URLs (e.g. underscores in query
  // strings) or code.
  const parts = value.split(
    /(\[[^\]]+\]\(https:\/\/[^\s)]+\)|https:\/\/[^\s)]+|`[^`]+`)/g,
  )
  const stripped = parts
    .map((part) => {
      const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/)
      if (link) return `${stripEmphasisOnly(link[1]!)} (${link[2]!})`
      if (part.startsWith('https://')) return part
      if (part.startsWith('`') && part.endsWith('`')) return part.slice(1, -1)
      return stripEmphasisOnly(part)
    })
    .join('')
  return decodeEntities(stripped)
}

export { HTTPS_URL }
