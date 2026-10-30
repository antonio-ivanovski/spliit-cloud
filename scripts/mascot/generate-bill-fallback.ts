import source from './bill-v2.source.json'

type Group = (typeof source.groups)[number]
type Shape = (typeof source.shapes)[number]
type Item = Group | Shape
const children = new Map<string, Item[]>()
for (const item of [...source.groups, ...source.shapes]) {
  const siblings = children.get(item.parent) ?? []
  siblings.push(item)
  children.set(item.parent, siblings)
}
const tokens: Record<string, string> = {
  '#fffff5dc': 'hsl(var(--mascot-paper))',
  '#ffe7d5ac': 'hsl(var(--mascot-paper-edge))',
  '#fff0e3c4': 'hsl(var(--mascot-paper-mid))',
  '#ff7c8c71': 'hsl(var(--mascot-stroke))',
  '#ff33483f': 'hsl(var(--mascot-ink))',
  '#ffa7af8e': 'hsl(var(--mascot-rule))',
}
const color = (value: string) => tokens[value] ?? `#${value.slice(3)}`

function render(item: Item): string {
  const name = item.name
  if (name === 'effects') return ''
  if (!('paints' in item)) {
    let transform = `transform="translate(${item.x} ${item.y})"`
    let opacity = ''
    if (name === 'leftHalf')
      transform = 'transform={open ? "translate(-13 0) rotate(-5)" : undefined}'
    if (name === 'rightHalf')
      transform = 'transform={open ? "translate(13 0) rotate(5)" : undefined}'
    if (name === 'face') opacity = 'opacity={open ? 0 : 1}'
    if (name.endsWith('Twin')) opacity = 'opacity={open ? 1 : 0}'
    if (name === 'mouth')
      transform =
        'transform={reaction === "failure" ? "translate(0 8) scale(1 -0.7)" : "translate(0 8)"}'
    if (name === 'rightShoulder')
      transform =
        'transform={reaction === "welcome" ? "translate(31 1) rotate(-100)" : "translate(31 1)"}'
    const contents = (children.get(name) ?? [])
      .sort((a, b) => a.order - b.order)
      .map(render)
      .join('\n')
    return `<g ${transform} ${opacity}>${contents}</g>`
  }
  const fill = item.paints.find((paint) => paint.paintType === 'fill')
  const stroke = item.paints.find((paint) => paint.paintType === 'stroke')
  const paints = `fill="${fill ? color(fill.color) : 'none'}" ${stroke ? `stroke="${color(stroke.color)}" strokeWidth="${'width' in stroke ? stroke.width : 1}"` : ''}`
  if ('primitive' in item && item.primitive) {
    return `<ellipse cx="${item.x}" cy="${item.y}" rx="${item.width / 2}" ry="${item.height / 2}" ${paints} />`
  }
  return `<path d="${'path' in item ? item.path : ''}" ${paints} />`
}

const output = `import type { MascotCharacterProps } from '../../mascot-character'

// Generated from scripts/mascot/bill-v2.source.json with Bun; format after generation.
export function BillFallback({ className, open = false, reaction = 'idle' }: MascotCharacterProps) {
  return (
    <svg viewBox="0 0 140 158" className={className} aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      ${render(source.groups[0])}
    </svg>
  )
}
`
await Bun.write(
  new URL(
    '../../apps/web/src/components/mascot/characters/bill/bill-fallback.tsx',
    import.meta.url,
  ),
  output,
)
