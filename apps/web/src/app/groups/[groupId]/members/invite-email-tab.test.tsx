import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { InviteEmailTab } from './invite-email-tab'
import type { EmailFormValues } from './members-hooks'

const mocks = vi.hoisted(() => ({
  emailDeliveryEnabled: true as boolean | null,
}))

vi.mock('@/lib/deployment-config', () => ({
  useDeploymentConfig: () => ({
    emailDeliveryEnabled: mocks.emailDeliveryEnabled,
  }),
}))

beforeEach(() => {
  mocks.emailDeliveryEnabled = true
})

function Wrapper() {
  const form = useForm<EmailFormValues>({
    defaultValues: { email: '', temporaryName: '' },
  })
  return (
    <InviteEmailTab
      form={form}
      onSubmit={() => {}}
      roleValue="MEMBER"
      canInviteAdmin={false}
      onRoleChange={() => {}}
      isPending={false}
      email=""
    />
  )
}

describe('InviteEmailTab', () => {
  it('warns that no email will be sent when delivery is disabled', () => {
    mocks.emailDeliveryEnabled = false

    render(<Wrapper />)

    expect(
      screen.getByText(
        'Email delivery is turned off on this instance. The invitation is still created and will appear when the invitee signs in; use a link invite to give them something to open.',
      ),
    ).toBeInTheDocument()
  })

  it('hides the delivery warning when delivery is enabled', () => {
    render(<Wrapper />)

    expect(
      screen.queryByText(/Email delivery is turned off/),
    ).not.toBeInTheDocument()
  })

  it('stays neutral while delivery state is unknown', () => {
    mocks.emailDeliveryEnabled = null

    render(<Wrapper />)

    expect(
      screen.queryByText(/Email delivery is turned off/),
    ).not.toBeInTheDocument()
  })
})
