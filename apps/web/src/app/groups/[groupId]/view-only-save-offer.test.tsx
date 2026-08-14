import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ViewOnlyBanner, ViewOnlySaveOffer } from './view-only-save-offer'

const save = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderOffer(props?: {
  persistToAccount?: boolean
  pending?: boolean
}) {
  return render(
    <ViewOnlySaveOffer
      persistToAccount={props?.persistToAccount ?? true}
      pending={props?.pending ?? false}
      onSave={save}
    />,
  )
}

function renderBanner(props?: {
  isPublicLink?: boolean
  isSaved?: boolean
  persistToAccount?: boolean
  pending?: boolean
}) {
  return render(
    <ViewOnlyBanner
      isPublicLink={props?.isPublicLink ?? true}
      isSaved={props?.isSaved ?? false}
      persistToAccount={props?.persistToAccount ?? true}
      pending={props?.pending ?? false}
      onSave={save}
    />,
  )
}

describe('ViewOnlySaveOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers Save group with the dashboard note when signed in', async () => {
    renderOffer()
    expect(
      screen.getByText('viewOnlyBannerSaveNoteAccount', { exact: false }),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'viewOnlyBannerSave' }),
    )
    expect(save).toHaveBeenCalled()
  })

  it('uses the device note when signed out', () => {
    renderOffer({ persistToAccount: false })
    expect(
      screen.getByText('viewOnlyBannerSaveNoteDevice', { exact: false }),
    ).toBeInTheDocument()
  })
})

describe('ViewOnlyBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dismisses the entire view-only note for this visit', async () => {
    renderBanner()
    expect(screen.getByText('viewOnlyBannerTitle')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByText('viewOnlyBannerTitle')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'viewOnlyBannerSave' }),
    ).toBeNull()
  })

  it('hides the note once the group is saved', () => {
    renderBanner({ isSaved: true })
    expect(screen.queryByText('viewOnlyBannerTitle')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'viewOnlyBannerSave' }),
    ).toBeNull()
  })

  it('hides the note when the visitor is not on a public view link', () => {
    renderBanner({ isPublicLink: false })
    expect(screen.queryByText('viewOnlyBannerTitle')).toBeNull()
  })
})
