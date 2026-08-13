import { describe, expect, it } from 'vitest'

import { render, screen } from '@/test/test-utils'
import type { NormalizedSource } from '@spliit/domain/import'

import { LegacyExportWarning } from './legacy-export-warning'

const source: NormalizedSource = {
  provider: 'SPLIIT',
  exportVersion: null,
  sourceGroupId: 'source-group',
  sourceUrl: 'https://spliit.app/groups/source-group',
  name: 'Trip',
  currency: '€',
  currencyCode: 'EUR',
  participants: [],
  expenses: [],
  documentSource: 'DISCOVERY',
}

describe('LegacyExportWarning', () => {
  it('recommends a current export for an unversioned JSON import', () => {
    render(<LegacyExportWarning source={source} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      /newer Spliit export is available/i,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      /copy the group link.*download a new JSON export/i,
    )
  })

  it('does not warn for export v3', () => {
    render(<LegacyExportWarning source={{ ...source, exportVersion: 3 }} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
