import { ResponsiveChoicePicker } from '@/components/responsive-choice-picker'
import { useMediaQuery } from '@/lib/hooks'
import { fireEvent, render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: vi.fn(() => true),
}))

const mediaQueryMock = vi.mocked(useMediaQuery)

const options = [
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
] as const

function renderPicker() {
  const onValueChange = vi.fn()
  render(
    <ResponsiveChoicePicker
      value="weekly"
      options={options}
      onValueChange={onValueChange}
      ariaLabel="Frequency"
      mobileTitle="Choose frequency"
    />,
  )
  return onValueChange
}

describe('ResponsiveChoicePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaQueryMock.mockReturnValue(true)
  })

  it('renders a desktop popover and selects an option', () => {
    const onValueChange = renderPicker()

    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))
    expect(
      screen.getByRole('listbox', { name: 'Frequency' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Every month' }))

    expect(onValueChange).toHaveBeenCalledWith('monthly')
  })

  it('renders the options in a bottom drawer on mobile', () => {
    mediaQueryMock.mockReturnValue(false)
    renderPicker()

    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Choose frequency' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Every month' }),
    ).toBeInTheDocument()
  })

  it('supports arrow-key navigation and selection', () => {
    const onValueChange = renderPicker()
    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))

    const weekly = screen.getByRole('option', { name: 'Every week' })
    const monthly = screen.getByRole('option', { name: 'Every month' })
    weekly.focus()
    fireEvent.keyDown(weekly, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(monthly)
    fireEvent.keyDown(monthly, { key: 'Enter' })

    expect(onValueChange).toHaveBeenCalledWith('monthly')
  })

  it('supports first-letter typeahead', () => {
    const onValueChange = renderPicker()
    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))

    const weekly = screen.getByRole('option', { name: 'Every week' })
    const monthly = screen.getByRole('option', { name: 'Every month' })
    weekly.focus()
    fireEvent.keyDown(weekly, { key: 'm' })
    expect(document.activeElement).toBe(monthly)
    fireEvent.keyDown(monthly, { key: 'Enter' })

    expect(onValueChange).toHaveBeenCalledWith('monthly')
  })
})
