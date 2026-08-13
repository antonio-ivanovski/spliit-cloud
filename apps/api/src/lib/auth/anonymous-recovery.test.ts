import { describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  anonymousRecovery,
  createRotationActivationTicket,
  decryptPendingRecoveryKey,
  encryptPendingRecoveryKey,
  generateAnonymousRecoveryKey,
  hashAnonymousRecoveryKey,
  readRotationActivationTicket,
} from './anonymous-recovery'

describe('anonymous recovery keys', () => {
  it('generates a versioned 256-bit URL-safe key', () => {
    expect(generateAnonymousRecoveryKey()).toMatch(
      /^spliit_anonymous_v1_[A-Za-z0-9_-]{43}$/,
    )
  })

  it('hashes deterministically without retaining the raw key', () => {
    const key = generateAnonymousRecoveryKey()
    const hash = hashAnonymousRecoveryKey(key)
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(key)
    expect(hashAnonymousRecoveryKey(key)).toBe(hash)
  })

  it('encrypts a pending key for reload-safe onboarding', () => {
    const key = generateAnonymousRecoveryKey()
    const envelope = encryptPendingRecoveryKey(key, 'account-1')
    expect(envelope).not.toContain(key)
    expect(decryptPendingRecoveryKey(envelope, 'account-1')).toBe(key)
    expect(() => decryptPendingRecoveryKey(envelope, 'account-2')).toThrow()
  })

  it('binds staged rotation tickets to the account and both key hashes', () => {
    const currentKeyHash = hashAnonymousRecoveryKey(
      generateAnonymousRecoveryKey(),
    )
    const replacementKeyHash = hashAnonymousRecoveryKey(
      generateAnonymousRecoveryKey(),
    )
    const ticket = createRotationActivationTicket({
      accountId: 'account-1',
      currentKeyHash,
      replacementKeyHash,
    })

    expect(ticket).not.toContain(currentKeyHash)
    expect(ticket).not.toContain(replacementKeyHash)
    expect(readRotationActivationTicket(ticket, 'account-1')).toEqual({
      accountId: 'account-1',
      currentKeyHash,
      replacementKeyHash,
      issuedAt: expect.any(Number),
    })
    expect(() => readRotationActivationTicket(ticket, 'account-2')).toThrow()
  })

  it('rejects tampered staged rotation tickets', () => {
    const ticket = createRotationActivationTicket({
      accountId: 'account-1',
      currentKeyHash: hashAnonymousRecoveryKey(generateAnonymousRecoveryKey()),
      replacementKeyHash: hashAnonymousRecoveryKey(
        generateAnonymousRecoveryKey(),
      ),
    })
    const tampered = `${ticket.slice(0, -1)}${ticket.endsWith('a') ? 'b' : 'a'}`

    expect(() => readRotationActivationTicket(tampered, 'account-1')).toThrow()
  })

  it('rejects expired staged rotation tickets', () => {
    vi.useFakeTimers()
    const now = new Date('2026-01-01T00:00:00.000Z')
    vi.setSystemTime(now)
    const ticket = createRotationActivationTicket({
      accountId: 'account-1',
      currentKeyHash: hashAnonymousRecoveryKey(generateAnonymousRecoveryKey()),
      replacementKeyHash: hashAnonymousRecoveryKey(
        generateAnonymousRecoveryKey(),
      ),
    })
    vi.setSystemTime(new Date(now.getTime() + 11 * 60 * 1000))

    expect(() => readRotationActivationTicket(ticket, 'account-1')).toThrow(
      /expired/,
    )
    vi.useRealTimers()
  })

  it('acknowledges a pending key and accepts an idempotent retry', async () => {
    const endpoint = anonymousRecovery().endpoints.acknowledgeAnonymousRecovery
    const code = generateAnonymousRecoveryKey()
    const pendingKeyCiphertext = encryptPendingRecoveryKey(code, 'account-1')
    prismaMock.anonymousRecoveryCredential.findUnique
      .mockResolvedValueOnce({
        keyHash: hashAnonymousRecoveryKey(code),
        pendingKeyCiphertext,
        acknowledgedAt: null,
        onboardingCompletedAt: null,
      } as never)
      .mockResolvedValueOnce({
        pendingKeyCiphertext: null,
        acknowledgedAt: new Date(),
        onboardingCompletedAt: new Date(),
      } as never)
    const request = {
      body: { confirmedCopied: true, code },
      context: {
        session: {
          session: { id: 'session-1' },
          user: { id: 'account-1', isAnonymous: true },
        },
      },
    } as never

    await expect(endpoint(request)).resolves.toEqual({ success: true })
    await expect(endpoint(request)).resolves.toEqual({ success: true })

    expect(prismaMock.anonymousRecoveryCredential.update).toHaveBeenCalledTimes(
      1,
    )
    expect(prismaMock.anonymousRecoveryCredential.update).toHaveBeenCalledWith({
      where: { accountId: 'account-1' },
      data: {
        pendingKeyCiphertext: null,
        acknowledgedAt: expect.any(Date),
        onboardingCompletedAt: expect.any(Date),
      },
    })
  })

  it('rejects acknowledgment without a pending or completed key', async () => {
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue({
      pendingKeyCiphertext: null,
      acknowledgedAt: null,
      onboardingCompletedAt: null,
    } as never)

    await expect(
      anonymousRecovery().endpoints.acknowledgeAnonymousRecovery({
        body: { confirmedCopied: true, code: generateAnonymousRecoveryKey() },
        context: {
          session: {
            session: { id: 'session-1' },
            user: { id: 'account-1', isAnonymous: true },
          },
        },
      } as never),
    ).rejects.toMatchObject({
      body: { code: 'PENDING_RECOVERY_KEY_REQUIRED' },
    })
  })

  it('rejects acknowledgment when another tab replaced the pending key', async () => {
    const displayedCode = generateAnonymousRecoveryKey()
    const currentCode = generateAnonymousRecoveryKey()
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue({
      keyHash: hashAnonymousRecoveryKey(currentCode),
      pendingKeyCiphertext: encryptPendingRecoveryKey(currentCode, 'account-1'),
      acknowledgedAt: null,
      onboardingCompletedAt: null,
    } as never)

    await expect(
      anonymousRecovery().endpoints.acknowledgeAnonymousRecovery({
        body: { confirmedCopied: true, code: displayedCode },
        context: {
          session: {
            session: { id: 'session-1' },
            user: { id: 'account-1', isAnonymous: true },
          },
        },
      } as never),
    ).rejects.toMatchObject({
      body: { code: 'PENDING_RECOVERY_KEY_CHANGED' },
    })
    expect(prismaMock.anonymousRecoveryCredential.update).not.toHaveBeenCalled()
  })

  it('returns a generic error for an invalid recovery key', async () => {
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue(null)

    await expect(
      anonymousRecovery().endpoints.signInAnonymousRecovery({
        body: { code: 'not-a-recovery-key' },
        request: new Request(
          'https://api.example/auth/sign-in/anonymous-recovery',
        ),
        setHeader() {},
      } as never),
    ).resolves.toEqual({ code: 'INVALID_RECOVERY_KEY' })
  })

  it('stages a replacement without changing the active recovery hash', async () => {
    const currentKeyHash = hashAnonymousRecoveryKey(
      generateAnonymousRecoveryKey(),
    )
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue({
      keyHash: currentKeyHash,
      acknowledgedAt: new Date(),
      onboardingCompletedAt: new Date(),
      pendingKeyCiphertext: null,
    } as never)
    const endpoint = anonymousRecovery().endpoints.rotateAnonymousRecovery

    const result = await endpoint({
      body: { confirmed: true },
      context: {
        session: {
          session: { id: 'session-1' },
          user: { id: 'account-1', isAnonymous: true },
        },
      },
      request: new Request(
        'https://api.example/auth/anonymous-recovery/rotate',
      ),
    } as never)

    expect(result).toMatchObject({
      recoveryUrl: expect.stringContaining('/auth/recover#code='),
      activationTicket: expect.any(String),
    })
    expect(result).not.toHaveProperty('code')
    expect(
      prismaMock.anonymousRecoveryCredential.updateMany,
    ).not.toHaveBeenCalled()
  })

  it('activates a staged replacement atomically and idempotently', async () => {
    const currentKeyHash = hashAnonymousRecoveryKey(
      generateAnonymousRecoveryKey(),
    )
    const replacementKeyHash = hashAnonymousRecoveryKey(
      generateAnonymousRecoveryKey(),
    )
    const activationTicket = createRotationActivationTicket({
      accountId: 'account-1',
      currentKeyHash,
      replacementKeyHash,
    })
    const endpoint =
      anonymousRecovery().endpoints.activateAnonymousRecoveryRotation
    prismaMock.anonymousRecoveryCredential.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    await expect(
      endpoint({
        body: { activationTicket, confirmedCopied: true },
        context: {
          session: {
            session: { id: 'session-1' },
            user: { id: 'account-1', isAnonymous: true },
          },
        },
      } as never),
    ).resolves.toEqual({ success: true })
    expect(
      prismaMock.anonymousRecoveryCredential.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        accountId: 'account-1',
        keyHash: currentKeyHash,
        acknowledgedAt: { not: null },
        onboardingCompletedAt: { not: null },
        pendingKeyCiphertext: null,
      },
      data: { keyHash: replacementKeyHash },
    })

    prismaMock.anonymousRecoveryCredential.updateMany.mockResolvedValueOnce({
      count: 0,
    })
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValueOnce({
      keyHash: replacementKeyHash,
    } as never)
    await expect(
      endpoint({
        body: { activationTicket, confirmedCopied: true },
        context: {
          session: {
            session: { id: 'session-1' },
            user: { id: 'account-1', isAnonymous: true },
          },
        },
      } as never),
    ).resolves.toEqual({ success: true })
  })
})
