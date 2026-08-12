import { describe, expect, it } from 'vitest'

import type { CloudGroupBundleInspection } from './cloud-bundle'
import {
  cloudInspectionToSource,
  initialCloudMappings,
  initialLegacyMappings,
} from './cloud-import-flow'

function inspection(
  participants: Array<{
    sourceId: string
    displayName: string
    identity?:
      | { kind: 'ACCOUNT'; accountId: string; email: string }
      | { kind: 'EMAIL'; email: string }
  }>,
): CloudGroupBundleInspection {
  return {
    kind: 'GROUP',
    manifest: {
      participants: participants.map((participant) => ({
        sourceId: participant.sourceId,
        displayName: participant.displayName,
        identity: participant.identity,
      })),
    },
  } as CloudGroupBundleInspection
}

describe('Cloud import mapping initialization', () => {
  it('places the signed-in account first even when the bundle lists it later', () => {
    const inspected = inspection([
      { sourceId: 'bob', displayName: 'Bob' },
      {
        sourceId: 'alice',
        displayName: 'Alice',
        identity: {
          kind: 'ACCOUNT',
          accountId: 'account-1',
          email: 'alice@example.com',
        },
      },
    ])
    const source = {
      participants: inspected.manifest.participants.map((participant) => ({
        sourceId: participant.sourceId,
        sourceName: participant.displayName,
      })),
    } as Parameters<typeof initialCloudMappings>[0]
    const mappings = initialCloudMappings(source, inspected, {
      id: 'account-1',
      name: 'Alice',
      email: 'alice@example.com',
    })

    expect(mappings.map((mapping) => mapping.source.sourceId)).toEqual([
      'alice',
      'bob',
    ])
    expect(mappings[0].mode).toBe('LINK_ACCOUNT')
  })

  it('uses match priority before deterministic display-name ordering', () => {
    const source = {
      participants: [
        { sourceId: 'z', sourceName: 'Zoe' },
        { sourceId: 'b', sourceName: 'Bob' },
        { sourceId: 'a', sourceName: 'Alice' },
      ],
    } as Parameters<typeof initialLegacyMappings>[0]
    const mappings = initialLegacyMappings(source, 'account-1')
    expect(mappings.map((mapping) => mapping.source.sourceName)).toEqual([
      'Zoe',
      'Alice',
      'Bob',
    ])
  })

  it('matches an exported email identity without an account id', () => {
    const inspected = inspection([
      {
        sourceId: 'alice',
        displayName: 'Alice',
        identity: { kind: 'EMAIL', email: 'alice@example.com' },
      },
    ])
    const source = {
      participants: [{ sourceId: 'alice', sourceName: 'Alice' }],
    } as Parameters<typeof initialCloudMappings>[0]
    const [mapping] = initialCloudMappings(source, inspected, {
      id: 'account-1',
      name: 'Different name',
      email: 'alice@example.com',
    })
    expect(mapping.mode).toBe('LINK_ACCOUNT')
    expect(mapping.linkedAccountId).toBe('account-1')
  })

  it('uses a unique normalized display-name match when identity metadata is absent', () => {
    const inspected = inspection([
      { sourceId: 'alice', displayName: '  Alice  ' },
      { sourceId: 'other', displayName: 'Alice' },
    ])
    const source = {
      participants: inspected.manifest.participants.map((participant) => ({
        sourceId: participant.sourceId,
        sourceName: participant.displayName,
      })),
    } as Parameters<typeof initialCloudMappings>[0]
    const mappings = initialCloudMappings(source, inspected, {
      id: 'account-1',
      name: 'Alice',
      email: 'alice@example.com',
    })
    expect(mappings.every((mapping) => mapping.mode !== 'LINK_ACCOUNT')).toBe(
      true,
    )

    const unique = inspection([{ sourceId: 'alice', displayName: '  Alice  ' }])
    const uniqueSource = {
      participants: [{ sourceId: 'alice', sourceName: '  Alice  ' }],
    } as Parameters<typeof initialCloudMappings>[0]
    expect(
      initialCloudMappings(uniqueSource, unique, {
        id: 'account-1',
        name: 'alice',
        email: 'alice@example.com',
      })[0].mode,
    ).toBe('LINK_ACCOUNT')
  })

  it('prefills a pending email identity as an invitation', () => {
    const inspected = inspection([
      {
        sourceId: 'bob',
        displayName: 'Bob',
        identity: { kind: 'EMAIL', email: 'bob@example.com' },
      },
    ])
    const source = {
      participants: [{ sourceId: 'bob', sourceName: 'Bob' }],
    } as Parameters<typeof initialCloudMappings>[0]
    const [mapping] = initialCloudMappings(source, inspected, {
      id: 'account-1',
      name: 'Alice',
      email: 'alice@example.com',
    })
    expect(mapping.mode).toBe('INVITE_BY_EMAIL')
    expect(mapping.inviteEmail).toBe('bob@example.com')
  })

  it('uses the peer display name for a FRIEND source', () => {
    const inspected = {
      ...inspection([
        {
          sourceId: 'alice',
          displayName: 'Alice',
          identity: {
            kind: 'ACCOUNT' as const,
            accountId: 'account-1',
            email: 'alice@example.com',
          },
        },
        { sourceId: 'bob', displayName: 'Bob' },
      ]),
      manifest: {
        ...inspection([
          {
            sourceId: 'alice',
            displayName: 'Alice',
            identity: {
              kind: 'ACCOUNT' as const,
              accountId: 'account-1',
              email: 'alice@example.com',
            },
          },
          { sourceId: 'bob', displayName: 'Bob' },
        ]).manifest,
        group: {
          groupType: 'FRIEND' as const,
          name: 'internal-ledger-id',
          ledger: { currency: '€', currencyCode: 'EUR' },
        },
        expenses: [],
      },
    } as unknown as CloudGroupBundleInspection
    expect(cloudInspectionToSource(inspected, 'account-1').name).toBe('Bob')
  })
})
