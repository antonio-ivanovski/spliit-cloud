import { describe, expect, it, vi } from 'vitest'

import { TimeZoneField } from '@/components/time-zone-field'
import { Label } from '@/components/ui/label'
import { render, screen } from '@/test/test-utils'

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: () => true,
}))

describe('TimeZoneField', () => {
  it('shows UTC and the selected city with its canonical identifier', () => {
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
    expect(trigger).toHaveTextContent('Europe/Skopje')
    expect(trigger).toHaveClass('min-w-0', 'overflow-hidden')
    expect(trigger.querySelectorAll('svg')).toHaveLength(1)
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
