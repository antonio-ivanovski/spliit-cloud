import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '@/AppShell'
import { render, screen } from '@/test/test-utils'

const route = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet" />,
  useLocation: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ pathname: route.pathname }),
}))

vi.mock('@/components/account-menu', () => ({
  AccountMenu: () => <button type="button">Account</button>,
}))
vi.mock('@/components/app-image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))
vi.mock('@/components/install-promotion-dialog', () => ({
  InstallPromotionDialog: () => null,
}))
vi.mock('@/components/push-notification-onboarding', () => ({
  PushNotificationOnboarding: () => null,
}))
vi.mock('@/components/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/locale-switcher', () => ({
  LocaleSwitcher: () => <button data-testid="locale-switcher">Locale</button>,
}))
vi.mock('@/components/mobile-shell', () => ({
  MobileAppBar: () => <header data-testid="focused-mobile-app-bar" />,
}))
vi.mock('@/components/offline-banner', () => ({ OfflineBanner: () => null }))
vi.mock('@/components/profile-gate', () => ({
  ProfileGate: ({ children }: React.PropsWithChildren) => children,
}))
vi.mock('@/components/progress-bar', () => ({ ProgressBar: () => null }))
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: React.PropsWithChildren) => children,
}))
vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/i18n/react', () => ({
  I18nProvider: ({ children }: React.PropsWithChildren) => children,
}))
vi.mock('@/trpc/client', () => ({
  TRPCProvider: ({ children }: React.PropsWithChildren) => children,
}))
vi.mock('react-i18next', () => ({
  Trans: () => <span>Translation</span>,
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('AppShell locale switcher placement', () => {
  afterEach(() => {
    route.pathname = '/'
  })

  it('renders the locale switcher in the desktop and normal mobile headers', () => {
    route.pathname = '/'
    render(<AppShell />)

    expect(screen.getAllByTestId('locale-switcher')).toHaveLength(2)
    expect(
      screen.getByRole('navigation', { name: 'Header.menu' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('focused-mobile-app-bar'),
    ).not.toBeInTheDocument()
  })

  it('renders the locale switcher in the desktop and focused mobile headers', () => {
    route.pathname = '/groups/create'
    render(<AppShell />)

    expect(screen.getAllByTestId('locale-switcher')).toHaveLength(2)
    expect(
      screen.getByRole('navigation', { name: 'Header.menu' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('focused-mobile-app-bar')).toBeInTheDocument()
  })
})
