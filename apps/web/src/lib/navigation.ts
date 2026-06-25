import {
  redirect as routerRedirect,
  useLocation,
  useNavigate,
  type NavigateOptions,
} from '@tanstack/react-router'

type NavigateOptionsNoTo = Omit<NavigateOptions, 'to' | 'href'>
type NavigateOptionsTo =
  | { to: NavigateOptions['to']; href?: undefined }
  | { href: string; to?: undefined }

export function useRouter() {
  const navigate = useNavigate()
  return {
    push: (opts: NavigateOptionsTo & NavigateOptionsNoTo) =>
      navigate(opts as NavigateOptions),
    replace: (opts: NavigateOptionsTo & NavigateOptionsNoTo) =>
      navigate({ ...opts, replace: true } as NavigateOptions),
    back: () => window.history.back(),
    refresh: () => window.location.reload(),
  }
}

export function usePathname() {
  return useLocation({ select: (location) => location.pathname })
}

export function useSearchParams() {
  return new URLSearchParams(
    useLocation({ select: (location) => location.searchStr }),
  )
}

export function redirect(opts: NavigateOptionsTo & NavigateOptionsNoTo) {
  throw routerRedirect(opts as NavigateOptions)
}
