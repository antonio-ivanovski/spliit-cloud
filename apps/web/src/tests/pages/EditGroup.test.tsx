import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsReadOnlyGroupViewer: vi.fn(() => false),
  mockSplitPresetsList: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: mocks.mockUseCurrentGroup,
  useCurrentGroupOrNull: () => null,
  useIsReadOnlyGroupViewer: mocks.mockUseIsReadOnlyGroupViewer,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    features: {
      get: {
        useQuery: vi.fn(() => ({
          data: { enableBulkCategorize: false },
        })),
      },
    },
    groups: {
      getDetails: {
        useQuery: vi.fn(() => ({ data: null, isLoading: false })),
      },
      splitPresets: {
        list: {
          useQuery: mocks.mockSplitPresetsList,
        },
        create: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
        update: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
        delete: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
        setGroupDefault: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
        setPersonalDefault: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
      },
      update: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
      archive: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
      delete: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
      reports: {
        bounds: {
          useQuery: vi.fn(() => ({ data: undefined })),
        },
      },
    },
    useUtils: () => ({
      groups: {
        invalidate: vi.fn(),
        splitPresets: { list: { invalidate: vi.fn() } },
      },
    }),
  },
}))

vi.mock('@/app/groups/[groupId]/edit/edit-group-mutations', () => ({
  useUpdateGroupMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useArchiveGroupMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useDeleteGroupMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
}))

vi.mock('@/components/group-form', () => ({
  GroupForm: (props: {
    hideNameField?: boolean
    readOnly?: boolean
    additionalSettings?: React.ReactNode
  }) => (
    <div
      data-testid="group-form"
      data-hide-name-field={String(props.hideNameField)}
      data-read-only={String(props.readOnly)}
      data-has-additional-settings={String(!!props.additionalSettings)}
    >
      {props.hideNameField ? null : <input aria-label="Group name" />}
      GroupForm
    </div>
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/app/groups/[groupId]/use-group-access-search', () => ({
  useGroupAccessSearch: () => ({
    linkInviteToken: undefined,
    viewKey: undefined,
  }),
}))

vi.mock('@/lib/api-url', () => ({
  getApiBaseUrl: () => 'http://localhost:3001',
}))

vi.mock('@/components/force-archive-dialog', () => ({
  ForceArchiveDialog: () => null,
}))

vi.mock('@/app/groups/[groupId]/edit/delete-group-dialog', () => ({
  DeleteGroupDialog: () => null,
}))

vi.mock('@/app/groups/[groupId]/edit/group-view-link-card', () => ({
  PublicViewOnlyLinkSection: () => (
    <section data-testid="public-view-link-card">Public View-only link</section>
  ),
}))

import { EditGroup } from '@/app/groups/[groupId]/edit/edit-group'

function setFriendGroup() {
  mocks.mockUseCurrentGroup.mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: {
      id: 'group-1',
      name: 'fri-ledger-xyz',
      archived: false,
      currency: '€',
      currencyCode: 'EUR',
      groupType: 'FRIEND',
      friendPairKey: 'k1',
      participants: [
        {
          id: 'lp1',
          name: 'Alice',
          account: null,
          pending: false,
          unlinked: false,
        },
        {
          id: 'lp2',
          name: 'Bob',
          account: null,
          pending: false,
          unlinked: false,
        },
      ],
    },
    displayName: 'Alice & Bob',
    currentLedgerParticipantId: 'lp1',
    currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
    currentInvitation: null,
    linkInviteState: null,
  })
}

describe('EditGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockUseIsReadOnlyGroupViewer.mockReturnValue(false)
    setFriendGroup()
    mocks.mockSplitPresetsList.mockReturnValue({
      data: {
        presets: [],
        canManageShared: true,
        canManagePersonal: true,
        groupDefaults: {
          paidByPresetId: null,
          paidForPresetId: null,
        },
        personalDefaults: {
          paidBy: { mode: 'INHERIT', presetId: null },
          paidFor: { mode: 'INHERIT', presetId: null },
        },
      },
      isLoading: false,
    })
  })

  it('does not render the archive section for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.queryByText('Archive group')).not.toBeInTheDocument()
  })

  it('does not render the delete section for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.queryByText('Delete group')).not.toBeInTheDocument()
  })

  it('hides the group name field for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument()
    // Group form should still be rendered
    expect(screen.getByTestId('group-form')).toBeInTheDocument()
  })

  it('renders the settings card (GroupForm) for FRIEND groups', () => {
    render(<EditGroup />)

    expect(screen.getByTestId('group-form')).toBeInTheDocument()
  })

  // ── GROUP-type control tests (tasks 13.30, 13.31) ────────────────

  function setGroupGroup() {
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-2',
      group: {
        id: 'group-2',
        name: 'Regular Group',
        archived: false,
        currency: '$',
        currencyCode: 'USD',
        groupType: 'GROUP',
        friendPairKey: null,
        participants: [
          {
            id: 'lp1',
            name: 'Alice',
            account: null,
            pending: false,
            unlinked: false,
          },
        ],
      },
      displayName: 'Regular Group',
      currentLedgerParticipantId: 'lp1',
      currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })
  }

  it('renders archive section for GROUP groups (opposite of FRIEND assertion)', () => {
    setGroupGroup()
    render(<EditGroup />)

    expect(
      screen.getByRole('heading', { name: 'Archive group' }),
    ).toBeInTheDocument()
  })

  it('renders delete section for GROUP groups (opposite of FRIEND assertion)', () => {
    setGroupGroup()
    render(<EditGroup />)

    expect(
      screen.getByRole('heading', { name: 'Delete group' }),
    ).toBeInTheDocument()
  })

  it('renders the group name field for GROUP groups', () => {
    setGroupGroup()
    render(<EditGroup />)

    expect(screen.getByLabelText('Group name')).toBeInTheDocument()
  })

  it('renders the Public View-only link card below Group information', () => {
    setGroupGroup()
    render(<EditGroup />)

    const groupForm = screen.getByTestId('group-form')
    const publicViewLink = screen.getByTestId('public-view-link-card')
    expect(
      groupForm.compareDocumentPosition(publicViewLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps Paid-by Evenly selected with one participant in the preset editor', async () => {
    setGroupGroup()
    const { user } = render(<EditGroup />)

    await user.click(screen.getByRole('button', { name: 'Create preset' }))
    await user.click(screen.getByRole('radio', { name: 'Paid by' }))
    const evenly = screen.getByRole('radio', {
      name: /Multiple payers.*Evenly/,
    })
    await user.click(evenly)

    expect(evenly).toBeChecked()
    expect(
      screen.getByRole('radio', { name: /Single payer/ }),
    ).not.toBeChecked()
  })

  it('uses pointer radio options and the expense share steppers in the preset editor', async () => {
    setGroupGroup()
    const { user } = render(<EditGroup />)

    await user.click(screen.getByRole('button', { name: 'Create preset' }))

    const paidFor = screen.getByRole('radio', { name: 'Paid for' })
    expect(paidFor).toHaveClass('cursor-pointer')

    const byShares = screen.getByRole('radio', { name: /By shares/ })
    expect(byShares).toHaveClass('cursor-pointer')
    await user.click(byShares)

    const shares = screen.getByRole('textbox', { name: 'Shares for Alice' })
    await user.clear(shares)
    await user.type(shares, '1.5')
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    expect(shares).toHaveValue('1.6')

    await user.click(
      screen.getByRole('button', { name: 'Decrease shares for Alice' }),
    )
    expect(shares).toHaveValue('1.5')
  })

  it('uses the full preset creator width as the scroll owner', async () => {
    setGroupGroup()
    const { user } = render(<EditGroup />)

    await user.click(screen.getByRole('button', { name: 'Create preset' }))

    const dialog = screen.getByRole('dialog')
    const scrollBody = dialog.querySelector<HTMLElement>('.overflow-y-auto')
    expect(dialog).toHaveClass('gap-0', 'overflow-hidden', 'p-0')
    expect(scrollBody).toHaveClass('w-full', 'px-0')
    expect(scrollBody).toContainElement(
      screen.getByRole('textbox', { name: 'Name' }),
    )
  })

  it('uses one feature icon and omits empty separators from a default preset menu', async () => {
    setGroupGroup()
    mocks.mockSplitPresetsList.mockReturnValue({
      data: {
        presets: [
          {
            id: 'preset-1',
            name: 'Everyone splits equally',
            scope: 'SHARED',
            ownerAccountId: null,
            target: 'PAID_FOR',
            splitMode: 'EVENLY',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            participants: [{ participant: 'lp1', shares: 1 }],
          },
        ],
        canManageShared: true,
        canManagePersonal: true,
        groupDefaults: {
          paidByPresetId: null,
          paidForPresetId: 'preset-1',
        },
        personalDefaults: {
          paidBy: { mode: 'INHERIT', presetId: null },
          paidFor: { mode: 'PRESET', presetId: 'preset-1' },
        },
      },
      isLoading: false,
    })
    const { user, container } = render(<EditGroup />)

    expect(container.querySelectorAll('.lucide-chart-pie')).toHaveLength(1)
    expect(screen.getByText('Everyone splits equally')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preset actions' }))

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit preset' })).toBeVisible()
    expect(
      screen.getByRole('menuitem', { name: 'Delete preset' }),
    ).toBeVisible()
  })

  // ── Export card visibility ─────────────────────────────────────────

  it('renders the export options card for admins', () => {
    render(<EditGroup />)

    expect(
      screen.getByRole('button', { name: 'Print / save PDF' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download CSV' }),
    ).toHaveAttribute(
      'href',
      'http://localhost:3001/groups/group-1/expenses/export/csv',
    )
    expect(
      screen.getByRole('button', { name: 'Download bundle' }),
    ).toHaveAttribute(
      'href',
      'http://localhost:3001/groups/group-1/export/bundle',
    )
  })

  it('renders the export options card for members', () => {
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'fri-ledger-xyz',
        archived: false,
        currency: '€',
        currencyCode: 'EUR',
        groupType: 'FRIEND',
        friendPairKey: 'k1',
        participants: [],
      },
      displayName: 'Alice & Bob',
      currentLedgerParticipantId: 'lp1',
      currentMember: { id: 'cm-1', role: 'MEMBER', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })
    render(<EditGroup />)

    expect(screen.getByTestId('group-form')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Group settings' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Print / save PDF' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download CSV' }),
    ).toBeInTheDocument()
  })

  it('renders the regular Group information form read-only for invitees', () => {
    mocks.mockUseIsReadOnlyGroupViewer.mockReturnValue(true)
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Regular Group',
        information: 'Checkout is at 11am',
        archived: false,
        currency: '$',
        currencyCode: 'USD',
        groupType: 'GROUP',
        friendPairKey: null,
        participants: [],
      },
      displayName: 'Regular Group',
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: { id: 'inv-1', role: 'MEMBER', type: 'EMAIL' },
      linkInviteState: null,
    })
    render(<EditGroup />)

    expect(screen.getByTestId('group-form')).toHaveAttribute(
      'data-read-only',
      'true',
    )
    expect(screen.getByTestId('group-form')).toHaveAttribute(
      'data-has-additional-settings',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: 'Download CSV' }),
    ).not.toBeInTheDocument()
  })

  // GroupTabs Members tab is tested in apps/web/src/tests/components/GroupTabs.test.tsx
})
