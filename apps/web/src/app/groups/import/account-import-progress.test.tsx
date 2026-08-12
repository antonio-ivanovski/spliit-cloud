import { describe, expect, it } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { AccountImportProgress } from './account-import-progress'

describe('AccountImportProgress', () => {
  it('shows the current group and sequential progress', () => {
    render(
      <AccountImportProgress
        phase="active"
        current={2}
        total={4}
        groupName="Summer trip"
      />,
    )

    expect(
      screen.getByText('Import Spliit Cloud account backup'),
    ).toBeInTheDocument()
    expect(screen.getByText('Group 2 of 4: Summer trip')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Group 2 of 4: Summer trip',
    )
    expect(screen.getByRole('progressbar')).toHaveValue(2)
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '4')
  })

  it('shows the selected queue while the setup screen is active', () => {
    render(<AccountImportProgress phase="setup" selected={3} total={4} />)

    expect(screen.getByText('3 of 4 ledgers selected')).toBeInTheDocument()
    expect(
      screen.getByText(/This inspected bundle is ready to import/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
