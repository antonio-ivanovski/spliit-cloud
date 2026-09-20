import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { GroupForm } from './group-form'

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => null,
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => ({ defaultCurrencyCode: 'USD' }),
}))

type GroupProp = ComponentProps<typeof GroupForm>['group']

function makeGroup(overrides: Record<string, unknown>): GroupProp {
  return {
    information: null,
    currency: '€',
    currencyCode: 'EUR',
    color: null,
    ...overrides,
  } as unknown as GroupProp
}

describe('GroupForm title-emoji suggestion', () => {
  it('keeps a one-character remainder untouched instead of prefilling an invalid name', () => {
    render(
      <GroupForm
        group={makeGroup({ name: '🏝️ A', emoji: null })}
        hideActions
        onSubmit={async () => {}}
      />,
    )

    // "A" would fail the schema's min-2; the form must open with the stored
    // name as-is and the emoji still undecided. (Live typing still strips it
    // and fails validation instead.)
    expect(screen.getByDisplayValue('🏝️ A')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('prefills the stripped name and detected emoji', () => {
    render(
      <GroupForm
        group={makeGroup({ name: '🏝️ Trip', emoji: null })}
        hideActions
        onSubmit={async () => {}}
      />,
    )

    expect(screen.getByDisplayValue('Trip')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('leaves multi-emoji decoration in the name on mount', () => {
    render(
      <GroupForm
        group={makeGroup({ name: '🎉🎊 Party', emoji: null })}
        hideActions
        onSubmit={async () => {}}
      />,
    )

    expect(screen.getByDisplayValue('🎉🎊 Party')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '🎉' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('keeps a one-character import prefill untouched on the create path', () => {
    render(
      <GroupForm
        initialValues={{ name: '🏝️ A' }}
        hideActions
        onSubmit={async () => {}}
      />,
    )

    expect(screen.getByDisplayValue('🏝️ A')).toBeInTheDocument()
  })
})

describe('GroupForm custom color tile', () => {
  it('stays checked while invalid text is typed into the hex input', async () => {
    const { user } = render(<GroupForm hideActions onSubmit={async () => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Custom color…' }))
    await user.type(screen.getByLabelText('Custom color'), '#zzz')

    const tile = screen.getByRole('radio', { name: 'Custom color…' })
    expect(tile).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
