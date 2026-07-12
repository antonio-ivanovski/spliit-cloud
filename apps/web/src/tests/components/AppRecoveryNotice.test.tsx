import { AppRecoveryNotice } from '@/components/app-recovery-notice'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'

describe('AppRecoveryNotice', () => {
  it('stays hidden until asset recovery gives up its automatic retry', async () => {
    render(<AppRecoveryNotice />)

    expect(screen.queryByTestId('app-recovery-notice')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('spliit:asset-recovery-required'))
    })

    expect(await screen.findByTestId('app-recovery-notice')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeVisible()
  })
})
