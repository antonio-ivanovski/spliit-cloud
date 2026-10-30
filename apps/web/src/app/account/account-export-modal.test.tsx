import { describe, expect, it, vi } from 'vitest'

import { render, screen, within } from '@/test/test-utils'

import { AccountExportModal } from './account-export-modal'

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      groups: {
        useQuery: () => ({
          data: { groups: [] },
          isPending: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}))

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    Link: ({
      to,
      search,
      children,
      ...props
    }: {
      to: string
      search?: unknown
      children?: React.ReactNode
      [key: string]: unknown
    }) => (
      <a href={to} data-search={JSON.stringify(search)} {...props}>
        {children}
      </a>
    ),
  }
})

function selectionPayload(): Record<string, unknown> {
  const input = document.querySelector('input[name="selection"]')
  expect(input).not.toBeNull()
  return JSON.parse((input as HTMLInputElement).value)
}

async function openDialog() {
  const { user } = render(<AccountExportModal />)
  await user.click(screen.getByRole('button', { name: /^export$/i }))
  expect(
    screen.getByRole('dialog', { name: /export account backup/i }),
  ).toBeInTheDocument()
  return user
}

function personalToggle() {
  const row = screen.getByText('Personal data').closest('div')
  expect(row).not.toBeNull()
  return within(row as HTMLElement).getByRole('switch')
}

describe('AccountExportModal personal toggle', () => {
  it('includes personal data in the submit payload by default', async () => {
    await openDialog()

    const toggle = personalToggle()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(selectionPayload()).toMatchObject({ includePersonal: true })
  })

  it('toggling it off removes personal data from the submit payload', async () => {
    const user = await openDialog()

    await user.click(personalToggle())

    expect(personalToggle()).toHaveAttribute('aria-checked', 'false')
    expect(selectionPayload()).toMatchObject({ includePersonal: false })
  })
})
