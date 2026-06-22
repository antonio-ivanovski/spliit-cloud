import {
  redirect as routerRedirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'

export function useRouter() {
  const navigate = useNavigate()
  return {
    push: (to: string) => navigate({ to }),
    replace: (to: string) => navigate({ to, replace: true }),
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

export function redirect(to: string) {
  throw routerRedirect({ to })
}
