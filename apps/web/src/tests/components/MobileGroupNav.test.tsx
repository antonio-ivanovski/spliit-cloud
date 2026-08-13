import { describe, expect, it, vi } from 'vitest'

import { MobileGroupNav } from '@/components/mobile-shell'
import { render, screen } from '@/test/test-utils'

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ pathname: '/groups/group-1/expenses' }),
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: () => ({ group: { groupType: 'GROUP' } }),
}))

vi.mock('@/components/ui/responsive-dialog', () => ({
  ResponsiveDialog: ({ children }: React.PropsWithChildren) => children,
  ResponsiveDialogBody: ({ children }: React.PropsWithChildren) => children,
  ResponsiveDialogClose: ({ render }: { render: React.ReactNode }) => render,
  ResponsiveDialogContent: ({ children }: React.PropsWithChildren) => children,
  ResponsiveDialogHeader: ({ children }: React.PropsWithChildren) => children,
  ResponsiveDialogTitle: ({ children }: React.PropsWithChildren) => children,
}))

describe('MobileGroupNav', () => {
  it('includes feedback in the group actions menu', () => {
    render(<MobileGroupNav groupId="group-1" />)

    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute(
      'href',
      '/feedback',
    )
  })
})
