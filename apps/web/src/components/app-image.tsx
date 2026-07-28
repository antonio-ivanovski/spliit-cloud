import type { ImgHTMLAttributes } from 'react'

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  priority?: boolean
}

export default function Image({ priority: _priority, ...props }: Props) {
  return <img alt={props.alt ?? ''} {...props} />
}
