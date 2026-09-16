import { describe, expect, it } from 'vitest'

import { parseScannedInviteLink } from './parse-invite-link'

const TOKEN = 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2'

describe('parseScannedInviteLink', () => {
  it('parses a same-origin group invite URL', () => {
    expect(
      parseScannedInviteLink(
        `https://spliit.example/groups/grp-1?invite=${TOKEN}`,
      ),
    ).toEqual({
      groupId: 'grp-1',
      token: TOKEN,
      url: `https://spliit.example/groups/grp-1?invite=${TOKEN}`,
    })
  })

  it('accepts another http(s) origin with the same path shape', () => {
    const parsed = parseScannedInviteLink(
      `http://192.168.1.5:3000/groups/abc123?invite=${TOKEN}`,
    )
    expect(parsed?.groupId).toBe('abc123')
    expect(parsed?.token).toBe(TOKEN)
  })

  it('tolerates surrounding whitespace from scanners', () => {
    const parsed = parseScannedInviteLink(
      `  https://spliit.example/groups/grp-1?invite=${TOKEN}\n`,
    )
    expect(parsed?.groupId).toBe('grp-1')
  })

  it('rejects non-invite URLs', () => {
    expect(
      parseScannedInviteLink('https://spliit.example/groups/grp-1'),
    ).toBeNull()
    expect(
      parseScannedInviteLink(`https://spliit.example/groups/grp-1?viewKey=abc`),
    ).toBeNull()
    expect(parseScannedInviteLink('https://example.com/')).toBeNull()
    expect(parseScannedInviteLink('not a url')).toBeNull()
    expect(parseScannedInviteLink('')).toBeNull()
    expect(
      parseScannedInviteLink('javascript:alert(1)//groups/x?invite=' + TOKEN),
    ).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(
      parseScannedInviteLink(
        'https://spliit.example/groups/grp-1?invite=short',
      ),
    ).toBeNull()
    expect(
      parseScannedInviteLink(
        'https://spliit.example/groups/grp-1?invite=has space in token 123456',
      ),
    ).toBeNull()
  })
})
