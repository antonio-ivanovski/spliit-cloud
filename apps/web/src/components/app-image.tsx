import { ImgHTMLAttributes } from 'react'

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  priority?: boolean
}

export default function Image({ priority: _priority, ...props }: Props) {
  return <img {...props} />
}
