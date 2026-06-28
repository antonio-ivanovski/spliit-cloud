import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ThemeToggle } from '@/components/theme-toggle'

describe('ThemeToggle', () => {
  it('renders a dropdown trigger with Sun/Moon icons', () => {
    render(<ThemeToggle />)

    // The trigger is a button containing the Sun and Moon icons
    const trigger = screen.getByRole('button', { name: /toggle theme/i })
    expect(trigger).toBeInTheDocument()

    // Both icons are rendered (visible via CSS classes)
    // Sun is visible by default (not in dark mode)
    // We can check that SVG elements exist inside the trigger
    const svgs = trigger.querySelectorAll('svg')
    expect(svgs.length).toBe(2)
  })

  it('shows Light, Dark, and System options when dropdown is opened', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    // Open the dropdown by clicking the trigger
    const trigger = screen.getByRole('button', { name: /toggle theme/i })
    await user.click(trigger)

    // Now the dropdown content should be visible (portaled to body)
    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  it('clicking Dark calls setTheme with dark', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const trigger = screen.getByRole('button', { name: /toggle theme/i })
    await user.click(trigger)

    // Click the Dark option
    const darkItem = screen.getByText('Dark')
    expect(darkItem).toBeInTheDocument()
    await user.click(darkItem)

    // Verify localStorage was updated (side effect of setTheme)
    expect(localStorage.getItem('theme')).toBe('dark')
    // Verify the dark class was applied
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('clicking Light calls setTheme with light', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const trigger = screen.getByRole('button', { name: /toggle theme/i })
    await user.click(trigger)

    await user.click(screen.getByText('Light'))
    expect(localStorage.getItem('theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('clicking System calls setTheme with system', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const trigger = screen.getByRole('button', { name: /toggle theme/i })
    await user.click(trigger)

    await user.click(screen.getByText('System'))
    expect(localStorage.getItem('theme')).toBe('system')
    // matchMedia returns false → resolved to light → no dark class
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
