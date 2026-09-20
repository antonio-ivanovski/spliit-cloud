import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncedAccountPreferencesProvider } from '@/components/account-preferences-sync'
import { GroupForm, type Props } from '@/components/group-form'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { render, screen, within } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/currency', () => ({
  getCurrency: vi.fn(),
  useCurrencies: vi.fn(),
}))

// ── Fixtures ────────────────────────────────────────────────────────────

const defaultCurrencies = [
  {
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
    name: 'US Dollar',
  },
  { code: 'EUR', symbol: '€', rounding: 0, decimal_digits: 2, name: 'Euro' },
]

const mockGroup = {
  id: 'group-1',
  slug: 'test-group',
  name: 'Test Group',
  information: 'A test group',
  archived: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ledgerId: 'ledger-1',
  currency: '$',
  currencyCode: 'USD',
  groupType: 'GROUP' as const,
  emoji: null,
  color: null,
  friendPairKey: null,
  ledger: {
    id: 'ledger-1',
    currency: '$',
    currencyCode: 'USD',
    groupId: 'group-1',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  members: [],
  invitations: [],
  participants: [
    {
      id: 'lp-1',
      name: 'Alice',
      account: null,
      pending: false,
      unlinked: false,
    },
    {
      id: 'lp-2',
      name: 'Bob',
      account: null,
      pending: false,
      unlinked: false,
    },
  ],
}

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(useCurrencies).mockReturnValue(defaultCurrencies)
  vi.mocked(getCurrency).mockImplementation(
    (code: string) =>
      defaultCurrencies.find((c) => c.code === code) ?? {
        code: '',
        symbol: '',
        rounding: 0,
        decimal_digits: 2,
      },
  )
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('GroupForm', () => {
  it('preserves an explicitly empty custom currency code over account defaults', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <SyncedAccountPreferencesProvider
        value={{
          defaultCurrencyCode: 'USD',
          timeZone: 'UTC',
          locale: null,
          theme: null,
          aiCategoryExtractEnabled: null,
          aiReceiptScanEnabled: null,
          aiVoiceExpenseEnabled: null,
        }}
      >
        <GroupForm
          initialValues={{
            name: 'Trip',
            currency: 'gold',
            currencyCode: '',
          }}
          onSubmit={onSubmit}
        />
      </SyncedAccountPreferencesProvider>,
    )

    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      currency: 'gold',
      currencyCode: '',
    })
  })

  it('hydrates currency after an unrelated name edit', async () => {
    const onSubmit = vi.fn()
    const view = render(
      <SyncedAccountPreferencesProvider value={null}>
        <GroupForm onSubmit={onSubmit} />
      </SyncedAccountPreferencesProvider>,
    )
    await view.user.type(
      screen.getByRole('textbox', { name: /group name/i }),
      'Weekend',
    )

    view.rerender(
      <SyncedAccountPreferencesProvider
        value={{
          defaultCurrencyCode: 'EUR',
          timeZone: 'Europe/Paris',
          locale: null,
          theme: null,
          aiCategoryExtractEnabled: null,
          aiReceiptScanEnabled: null,
          aiVoiceExpenseEnabled: null,
        }}
      >
        <GroupForm onSubmit={onSubmit} />
      </SyncedAccountPreferencesProvider>,
    )

    expect(
      screen.getByRole('combobox', { name: 'Main currency' }),
    ).toHaveTextContent('Euro')
  })

  it('renders form with name, currency, and info fields in create mode', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    // All three main fields should be present
    expect(screen.getByText('Group name')).toBeInTheDocument()
    expect(
      screen.getByText('Group information', { selector: 'label' }),
    ).toBeInTheDocument()

    // Currency selector trigger (combobox) should be present
    expect(
      screen.getByRole('combobox', { name: 'Main currency' }),
    ).toBeInTheDocument()

    // Create button should be present in create mode
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('uses a visible rounded card in every route mode', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    expect(screen.getByText('Group name').closest('.rounded-lg')).toHaveClass(
      'rounded-lg',
      'bg-card',
    )
  })

  it('renders the Members tab hint when creating and hideInviteHint is false', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    // The hint paragraph contains the inviteAfterCreate message
    expect(screen.getByText(/open the Members tab/i)).toBeInTheDocument()
  })

  it('hides the Members tab hint when hideInviteHint is true', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} hideInviteHint />)

    expect(screen.queryByText(/open the Members tab/i)).not.toBeInTheDocument()
  })

  it('renders read-only when currentMemberRole is MEMBER', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        currentMemberRole="MEMBER"
        onSubmit={onSubmit}
      />,
    )

    // Read-only note should be visible
    expect(screen.getByText(/only owners and admins/i)).toBeInTheDocument()

    // Name input should be disabled
    expect(screen.getByRole('textbox', { name: /name/i })).toBeDisabled()

    // Save button should NOT be present
    expect(
      screen.queryByRole('button', { name: /save|create/i }),
    ).not.toBeInTheDocument()
  })

  it('renders archived state with all inputs disabled', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        archived
        onSubmit={onSubmit}
      />,
    )

    // Archived notice should be visible
    expect(screen.getByText(/this group is archived/i)).toBeInTheDocument()

    // Name input should be disabled
    expect(screen.getByRole('textbox', { name: /name/i })).toBeDisabled()

    // Save button should NOT be present
    expect(
      screen.queryByRole('button', { name: /save|create/i }),
    ).not.toBeInTheDocument()
  })

  it('submit calls onSubmit with parsed form values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    // Fill in the name field (required, min 2 chars)
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    await user.clear(nameInput)
    await user.type(nameInput, 'My Vacation')

    // Click Create button
    const createButton = screen.getByRole('button', { name: /create/i })
    await user.click(createButton)

    // Wait for onSubmit to be called
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    // Verify the submitted values
    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).toHaveProperty('name', 'My Vacation')
    expect(submittedValues).toHaveProperty('participants')
    expect(submittedValues.participants).toHaveLength(1)
  })

  it('submit does NOT call onSubmit when readonly', async () => {
    const onSubmit = vi.fn()
    const { user: _user } = render(
      <GroupForm
        group={mockGroup as Props['group']}
        currentMemberRole="MEMBER"
        onSubmit={onSubmit}
      />,
    )

    // The form's handleSubmit returns early for read-only
    // Verify no save button exists
    expect(
      screen.queryByRole('button', { name: /save|create/i }),
    ).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('currency selector renders as a combobox', () => {
    const onSubmit = vi.fn()
    render(<GroupForm onSubmit={onSubmit} />)

    expect(
      screen.getByRole('combobox', { name: 'Main currency' }),
    ).toBeInTheDocument()
  })

  it('edit mode pre-fills group data', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm group={mockGroup as Props['group']} onSubmit={onSubmit} />,
    )

    // Name field should be pre-filled
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    expect(nameInput).toHaveValue('Test Group')

    // Save button should be present (not Create)
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('hides the name input when hideNameField is true', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        hideNameField
        onSubmit={onSubmit}
      />,
    )

    expect(
      screen.queryByRole('textbox', { name: /name/i }),
    ).not.toBeInTheDocument()
  })

  it('renders submit button when hideNameField is true (unlike MEMBER role)', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        hideNameField
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  // ── hideNameField fields still editable ────────────────────────

  it('currency selector is enabled when hideNameField is true', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        hideNameField
        onSubmit={onSubmit}
      />,
    )

    expect(
      screen.getByRole('combobox', { name: 'Main currency' }),
    ).not.toBeDisabled()
  })

  it('information textarea is enabled when hideNameField is true', () => {
    const onSubmit = vi.fn()
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        hideNameField
        onSubmit={onSubmit}
      />,
    )

    expect(
      screen.getByRole('textbox', { name: /group information/i }),
    ).not.toBeDisabled()
  })

  it('form submit includes currency and information changes when hideNameField is true', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <GroupForm
        group={mockGroup as Props['group']}
        hideNameField
        onSubmit={onSubmit}
      />,
    )

    const combobox = screen.getByRole('combobox', {
      name: 'Main currency',
    })
    await user.click(combobox)

    const euroOption = await screen.findByRole('option', { name: /Euro/ })
    await user.click(euroOption)

    const textarea = screen.getByRole('textbox', { name: /group information/i })
    await user.clear(textarea)
    await user.type(textarea, 'Updated info text')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const values = onSubmit.mock.calls[0][0]
    expect(values).toHaveProperty('currencyCode', 'EUR')
    expect(values).toHaveProperty('information', 'Updated info text')
    expect(values).not.toHaveProperty('timeZone')
  })

  // ── Appearance (inline pickers) ────────────────────────────────────

  it('create mode stays blank by default and submits a pick', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    await user.type(
      screen.getByRole('textbox', { name: /name/i }),
      'My Vacation',
    )

    // Nothing preselected: no emoji or color radio is checked.
    const checked = screen
      .queryAllByRole('radio', { checked: true })
      .map((radio) => radio.getAttribute('aria-label'))
    expect(checked).toEqual([])

    await user.click(screen.getByRole('radio', { name: '🎉' }))
    await user.click(screen.getByRole('radio', { name: 'Teal' }))
    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'My Vacation',
      emoji: '🎉',
      color: 'teal',
    })
  })

  it('moves a pasted title emoji into the picker immediately on create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: '🏝️ Weekend Trip' } })

    // The emoji never lands in the name field; it moves straight to the
    // picker, with an undo notice.
    expect(nameInput).toHaveValue('Weekend Trip')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(/Moved .* out of the name/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Weekend Trip',
      emoji: '🏝️',
    })
  })

  it('moves a typed title emoji while typing on create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    // Typed char by char: the variation selector arrives as its own keystroke
    // and must merge into the moved emoji instead of lingering in the name.
    await user.type(nameInput, '🏝️ Weekend Trip')

    expect(nameInput).toHaveValue('Weekend Trip')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Weekend Trip',
      emoji: '🏝️',
    })
  })

  it('undoes an automatic title-emoji move', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: '🏝️ Weekend Trip' } })
    expect(nameInput).toHaveValue('Weekend Trip')

    await user.click(screen.getByRole('button', { name: /^undo$/i }))

    expect(nameInput).toHaveValue('🏝️ Weekend Trip')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.queryByText(/Moved .* out of the name/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    // The server stores the name verbatim now; the emoji stays undecided.
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: '🏝️ Weekend Trip',
    })
    expect(onSubmit.mock.calls[0][0].emoji).toBeUndefined()
  })

  it('does not re-move the emoji after undo when typing continues', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: '🏝️ Weekend Trip' } })
    await user.click(screen.getByRole('button', { name: /^undo$/i }))
    await user.type(nameInput, '!')

    // Undo restored the emoji into the name on purpose; further edits must not
    // immediately rip it out again.
    expect(nameInput).toHaveValue('🏝️ Weekend Trip!')
    expect(screen.queryByText(/Moved .* out of the name/)).toBeNull()
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: '🏝️ Weekend Trip!',
    })
    expect(onSubmit.mock.calls[0][0].emoji).toBeUndefined()
  })

  it('leaves an explicitly picked emoji alone when typing emoji in the name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    await user.click(screen.getByRole('radio', { name: '🎉' }))
    fireEvent.change(nameInput, { target: { value: '🏝️ Weekend Trip' } })

    expect(nameInput).toHaveValue('🏝️ Weekend Trip')
    expect(screen.getByRole('radio', { name: '🎉' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByText(/Moved .* out of the name/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: '🏝️ Weekend Trip',
      emoji: '🎉',
    })
  })

  it('keeps deliberate multi-emoji decoration in the name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: '🎉🎊 Party' } })

    expect(nameInput).toHaveValue('🎉🎊 Party')
    expect(screen.queryByText(/Moved .* out of the name/)).toBeNull()
  })

  it('strips a title emoji even when the remainder fails name validation', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: '🏝️ A' } })

    expect(nameInput).toHaveValue('A')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // No error flashes before submit, even though the remainder is invalid.
    expect(screen.queryByText('Enter at least two characters.')).toBeNull()

    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByText('Enter at least two characters.'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('transfers an emoji-only name, leaving the name empty and invalid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: '🏝️' } })

    // The emoji moves to the picker even though nothing remains; the empty
    // name fails validation on submit, but no error flashes beforehand.
    expect(nameInput).toHaveValue('')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(/Moved .* out of the name/)).toBeInTheDocument()
    expect(screen.queryByText('Enter at least two characters.')).toBeNull()

    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByText('Enter at least two characters.'))
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^undo$/i }))

    expect(nameInput).toHaveValue('🏝️')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.queryByText(/Moved .* out of the name/)).toBeNull()
  })

  it('keeps the transfer notice while typing and undoes non-destructively', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    // Emoji-first flow: the transfer fires on the first character, and the
    // notice must survive the rest of the name being typed after it.
    await user.type(nameInput, '🍕')
    expect(nameInput).toHaveValue('')
    expect(screen.getByText(/Moved .* out of the name/)).toBeInTheDocument()

    await user.type(nameInput, 'Weekend Trip')
    expect(nameInput).toHaveValue('Weekend Trip')
    expect(screen.getByText(/Moved .* out of the name/)).toBeInTheDocument()

    // Undo keeps the typed text (restoring the pre-move name would clobber
    // it) and just unpicks the automatically moved emoji.
    await user.click(screen.getByRole('button', { name: /^undo$/i }))

    expect(nameInput).toHaveValue('Weekend Trip')
    expect(screen.getByRole('radio', { name: '🍕' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.queryByText(/Moved .* out of the name/)).toBeNull()
  })

  it('scrolls the emoji row to a transferred emoji', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<GroupForm onSubmit={onSubmit} />)
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    const row = screen.getByRole('radiogroup', { name: /emoji/i })
    const tile = screen.getByRole('radio', { name: '🏝️' })
    // Simulate an overflowing row with the picked tile out of view.
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 40,
      width: 200,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => {},
    })
    vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue({
      left: 300,
      top: 0,
      right: 340,
      bottom: 40,
      width: 40,
      height: 40,
      x: 300,
      y: 0,
      toJSON: () => {},
    })
    const scrollBy = vi.fn()
    row.scrollBy = scrollBy

    fireEvent.change(nameInput, { target: { value: '🏝️ Trip' } })

    // Centered on the tile: the row must scroll right (positive left) once.
    expect(scrollBy).toHaveBeenCalledTimes(1)
    const [scrollOptions] = scrollBy.mock.calls[0] as [{ left: number }]
    expect(scrollOptions.left).toBeGreaterThan(0)
  })

  it('keeps the stored name when the name and appearance fields are hidden', async () => {
    const group = { ...mockGroup, name: '🏝️ Test Group', emoji: null }
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <GroupForm
        group={group as Props['group']}
        hideNameField
        hideAppearance
        onSubmit={onSubmit}
      />,
    )

    // The hidden name must never be rewritten by the mount-time extraction.
    await user.click(screen.getByRole('button', { name: /save/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: '🏝️ Test Group' })
  })

  it('moves a newly typed title emoji live when editing', async () => {
    const group = { ...mockGroup, name: 'Test Group', emoji: null }
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <GroupForm group={group as Props['group']} onSubmit={onSubmit} />,
    )
    const nameInput = screen.getByRole('textbox', { name: /name/i })

    fireEvent.change(nameInput, { target: { value: 'Test Group 🏝️' } })

    expect(nameInput).toHaveValue('Test Group')
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(/Moved .* out of the name/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Test Group',
      emoji: '🏝️',
    })
  })

  it('moves a title emoji out of the name when the emoji is undecided', async () => {
    const group = { ...mockGroup, name: '🏝️ Test Group', emoji: null }
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <GroupForm group={group as Props['group']} onSubmit={onSubmit} />,
    )

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue(
      'Test Group',
    )
    expect(screen.getByRole('radio', { name: '🏝️' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('button', { name: /save/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Test Group',
      emoji: '🏝️',
    })
  })

  it('renders the None state for a declined emoji and clears picks', async () => {
    const declined = { ...mockGroup, emoji: '', color: null }
    const view1 = render(
      <GroupForm group={declined as Props['group']} onSubmit={vi.fn()} />,
    )
    expect(
      within(view1.container).getByRole('radio', { name: 'None' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      within(view1.container).getByRole('radio', { name: 'No color' }),
    ).toHaveAttribute('aria-checked', 'true')
    view1.unmount()

    const picked = { ...mockGroup, emoji: '🎉', color: 'teal' }
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view2 = render(
      <GroupForm group={picked as Props['group']} onSubmit={onSubmit} />,
    )
    await view2.user.click(
      within(view2.container).getByRole('radio', { name: 'None' }),
    )
    expect(
      within(view2.container).getByRole('radio', { name: 'None' }),
    ).toHaveAttribute('aria-checked', 'true')

    await view2.user.click(
      within(view2.container).getByRole('button', { name: /save/i }),
    )
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ emoji: '' })
  })

  it('applies a custom hex color through the trailing custom tile', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'My Trip')
    // The hex input only appears once the custom tile is selected.
    expect(screen.queryByLabelText('Custom color')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Custom color…' }))

    const hexInput = screen.getByLabelText('Custom color')
    await user.type(hexInput, '#a1b2c3')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ color: '#a1b2c3' })
  })

  it('applies a custom emoji through the trailing custom tile', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'My Trip')
    expect(screen.queryByLabelText('Custom emoji')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Custom emoji…' }))

    await user.type(screen.getByLabelText('Custom emoji'), '🦄')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ emoji: '🦄' })
  })

  it('collapses the custom emoji input back to None when cleared', async () => {
    const { user } = render(
      <GroupForm group={mockGroup as Props['group']} onSubmit={vi.fn()} />,
    )

    await user.click(screen.getByRole('radio', { name: 'Custom emoji…' }))
    await user.type(screen.getByLabelText('Custom emoji'), '🦄')
    expect(
      screen.getByRole('radio', { name: 'Custom emoji…' }),
    ).toHaveAttribute('aria-checked', 'true')

    await user.clear(screen.getByLabelText('Custom emoji'))
    expect(screen.queryByLabelText('Custom emoji')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // The unmounted input hands focus back to the tile it collapsed into.
    expect(screen.getByRole('radio', { name: 'None' })).toHaveFocus()
  })

  it('surfaces inline errors for invalid custom values and blocks submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'My Trip')
    await user.click(screen.getByRole('radio', { name: 'Custom color…' }))
    await user.type(screen.getByLabelText('Custom color'), '#zzz')
    expect(screen.getByText(/valid hex color/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Custom color')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/valid hex color/i)

    // The invalid hex reaches the form value, so submit is blocked even
    // though the emoji is untouched.
    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(onSubmit).not.toHaveBeenCalled()

    // Clearing collapses back to No color; reopen and enter a valid hex.
    await user.clear(screen.getByLabelText('Custom color'))
    expect(screen.queryByLabelText('Custom color')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No color' })).toHaveFocus()
    await user.click(screen.getByRole('radio', { name: 'Custom color…' }))
    await user.type(screen.getByLabelText('Custom color'), '#a1b2c3')
    await user.click(screen.getByRole('radio', { name: 'Custom emoji…' }))
    await user.type(screen.getByLabelText('Custom emoji'), 'abc')
    expect(screen.getByRole('alert')).toHaveTextContent(/single emoji/i)

    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('explains a short invalid hex after a blocked submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<GroupForm onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'My Trip')
    await user.click(screen.getByRole('radio', { name: 'Custom color…' }))
    await user.type(screen.getByLabelText('Custom color'), '#zz')
    // Too short to look "complete", so no error while typing...
    expect(screen.queryByText(/valid hex color/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: /create/i }))
    // ...but a blocked submit must say why instead of doing nothing.
    expect(await screen.findByText(/valid hex color/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('hides the appearance field when hideAppearance is true', async () => {
    render(
      <GroupForm
        group={mockGroup as Props['group']}
        hideAppearance
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByText('Group emoji')).not.toBeInTheDocument()
    expect(screen.queryByText('Group color')).not.toBeInTheDocument()
  })
})
