import {
  Link as RouterLink,
  type LinkProps as RouterLinkProps,
} from '@tanstack/react-router'
import type { AnchorHTMLAttributes } from 'react'
import { forwardRef } from 'react'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  replace?: boolean
  search?: RouterLinkProps['search']
  params?: RouterLinkProps['params']
}

export const Link = forwardRef<HTMLAnchorElement, Props>(function Link(
  { href, search, params, ...props },
  ref,
) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    return <a ref={ref} href={href} {...props} />
  }
  return (
    <RouterLink
      ref={ref}
      to={href as RouterLinkProps['to']}
      search={search}
      params={params}
      {...props}
    />
  )
})

export default Link
