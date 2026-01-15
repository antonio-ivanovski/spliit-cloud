const INVITE_EXPIRY_HOURS = 24

interface InvitePayload {
  groupId: string
  expiresAt: number
}

export function generateInviteToken(
  groupId: string,
  expiryHours: number = INVITE_EXPIRY_HOURS,
): string {
  const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000
  const payload: InvitePayload = { groupId, expiresAt }

  // In production, this should be encrypted/signed with a secret
  // For now, we'll use base64 encoding with a simple format
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `inv_${encoded}`
}

export function verifyInviteToken(token: string): InvitePayload {
  if (!token.startsWith('inv_')) {
    throw new Error('Invalid invite token format')
  }

  try {
    const encoded = token.substring(4)
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8')
    const payload: InvitePayload = JSON.parse(decoded)

    if (payload.expiresAt < Date.now()) {
      throw new Error('Invite token has expired')
    }

    return payload
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      throw error
    }
    throw new Error('Invalid invite token')
  }
}

export function createInviteUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/groups/join/${token}`
}
