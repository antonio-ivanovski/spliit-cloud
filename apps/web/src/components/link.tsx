import {
  Link as RouterLink,
  type LinkProps as RouterLinkProps,
} from '@tanstack/react-router'
import { AnchorHTMLAttributes, forwardRef } from 'react'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  replace?: boolean
}

export const Link = forwardRef<HTMLAnchorElement, Props>(function Link(
  { href, ...props },
  ref,
) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    return <a ref={ref} href={href} {...props} />
  }
  return <RouterLink ref={ref} to={href as RouterLinkProps['to']} {...props} />
})

export default Link
