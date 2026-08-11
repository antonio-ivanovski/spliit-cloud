import { describe, expect, it, vi } from 'vitest'

import { TimeZoneField } from '@/components/time-zone-field'
import { Label } from '@/components/ui/label'
import { render, screen } from '@/test/test-utils'

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: () => true,
}))

describe('TimeZoneField', () => {
  it('shows the selected city and offset on the trigger', () => {
    render(
      <>
        <Label htmlFor="zone">Timezone</Label>
        <TimeZoneField
          id="zone"
          value="Europe/Skopje"
          onChange={() => undefined}
        />
      </>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Timezone' })
    expect(trigger).toHaveTextContent('Skopje')
    expect(trigger).toHaveTextContent(/GMT|UTC/)
    expect(trigger).not.toHaveTextContent('Europe/Skopje')
    expect(trigger).toHaveClass('min-w-0', 'overflow-hidden', 'h-10')
    expect(trigger.querySelectorAll('svg')).toHaveLength(1)
  })

  it('scrolls the open list so the current timezone is in view', async () => {
    const { user } = render(
      <>
        <Label htmlFor="zone">Timezone</Label>
        <TimeZoneField
          id="zone"
          value="Pacific/Auckland"
          onChange={() => undefined}
        />
      </>,
    )

    await user.click(screen.getByRole('combobox', { name: 'Timezone' }))
    expect(screen.getAllByRole('option').length).toBeLessThan(20)
    const current = document.querySelector(
      '[data-current-timezone="true"]',
    ) as HTMLElement | null
    expect(current).not.toBeNull()
    expect(current).toHaveTextContent('Auckland')
  })

  it('searches by city and selects the IANA timezone', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <>
        <Label htmlFor="zone">Timezone</Label>
        <TimeZoneField id="zone" value="UTC" onChange={onChange} />
      </>,
    )

    await user.click(screen.getByRole('combobox', { name: 'Timezone' }))
    await user.type(
      screen.getByPlaceholderText('Search timezones or cities'),
      'Skopje',
    )
    await user.click(
      screen.getByRole('option', { name: /Skopje.*Europe\/Skopje/ }),
    )

    expect(onChange).toHaveBeenCalledWith('Europe/Skopje')
  })
})
